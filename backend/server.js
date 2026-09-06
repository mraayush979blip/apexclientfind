require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { ApifyClient } = require('apify-client');
const axios = require('axios');
const cheerio = require('cheerio');
const Groq = require('groq-sdk');
const mongoose = require('mongoose');

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

const APIFY_API_TOKEN = process.env.APIFY_API_TOKEN;

// Initialize the ApifyClient with API token
const client = new ApifyClient({
    token: process.env.APIFY_API_TOKEN,
});

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY,
});

// Connect to MongoDB Atlas
if (!process.env.MONGODB_URI) {
    console.error('CRITICAL: MONGODB_URI is not set in .env');
} else {
     mongoose.connect(process.env.MONGODB_URI)
        .then(() => console.log('Connected to MongoDB Atlas successfully.'))
        .catch((err) => console.error('MongoDB connection error:', err));
}

const LeadSchema = new mongoose.Schema({
    name: String,
    address: String,
    phone: String,
    website: String,
    rating: Number,
    reviewsCount: Number,
    status: { type: String, default: 'Not Messaged' },
    responseNotes: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now }
});

const Lead = mongoose.model('Lead', LeadSchema);

const SearchHistorySchema = new mongoose.Schema({
    location: String,
    category: String,
    resultsCount: Number,
    leads: { type: mongoose.Schema.Types.Mixed },
    timestamp: { type: Date, default: Date.now }
});
const SearchHistory = mongoose.model('SearchHistory', SearchHistorySchema);

const SeenLeadSchema = new mongoose.Schema({
    // Keep it generic to allow saving full lead payload
    leadId: { type: String, required: true, unique: true },
    data: { type: mongoose.Schema.Types.Mixed },
    timestamp: { type: Date, default: Date.now }
});
const SeenLead = mongoose.model('SeenLead', SeenLeadSchema);

app.post('/api/scan', async (req, res) => {
    const { location, category, limit } = req.body;
    const maxPlaces = limit || 100;
    
    if (!location || !category) {
        return res.status(400).json({ error: 'Location and category are required' });
    }

    req.on('close', () => {
        console.log(`Connection closed for scan ${category} in ${location}`);
    });

    // Set headers for SSE
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });

    // Helper to send SSE events
    const sendEvent = (data) => {
        if (res.writableEnded) return;
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    console.log(`Starting scan for ${category} in ${location} ...`);
    
    // We will collect leads from all available sources
    const sources = [];
    
    // 1. Apify Source (if token exists)
    if (APIFY_API_TOKEN) {
        const apifyPromise = (async () => {
            try {
                const query = `${category} in ${location}`;
                console.log(`Calling Apify (compass~crawler-google-places) for: ${query} with limit ${maxPlaces}`);
                
                const input = {
                    "searchStringsArray": [query],
                    "maxCrawledPlacesPerSearch": maxPlaces,
                    "language": "en",
                    "maxImages": 0,
                    "maxReviews": 0
                };
        
                const run = await client.actor("compass~crawler-google-places").call(input);
                const { items } = await client.dataset(run.defaultDatasetId).listItems();
                
                const locationLower = location.toLowerCase();
                const locationParts = locationLower.split(/[\s,]+/).filter(p => p.length > 2);
                
                const allLeads = items.filter(lead => {
                    const addressLower = (lead.address || '').toLowerCase();
                    if (locationParts.length === 0) return true;
                    return locationParts.some(part => addressLower.includes(part));
                });
                
                // If we have literally 0 leads, return empty (don't fallback to mock here because we have multiple sources)
                if (allLeads.length === 0) {
                    console.log("No leads found by Apify.");
                    sendEvent({ source: 'Apify', leads: [] });
                    return [];
                }

                console.log(`Found ${allLeads.length} total leads from Apify. Deduplicating...`);
                
                // Deduplicate across paginations
                const uniqueLeads = [];
                const seenNames = new Set();
                
                for (const lead of allLeads) {
                    const normalizedName = lead.title ? lead.title.toLowerCase().trim() : '';
                    if (!seenNames.has(normalizedName)) {
                        seenNames.add(normalizedName);
                        uniqueLeads.push(lead);
                    }
                }

                // Respect the requested limit (though Apify respects it internally, combining adds more)
                const limitedLeads = uniqueLeads.slice(0, maxPlaces);
                
                const processedLeads = limitedLeads.map((l, index) => ({
                    id: `apify-${index}`,
                    name: l.title || 'Unknown Business',
                    address: l.address || l.city || location,
                    phone: l.phone || l.phoneUnformatted || '',
                    hasPhone: !!l.phone || !!l.phoneUnformatted,
                    website: l.website || '',
                    hasWebsite: (l.website !== '' && !l.website?.includes('facebook.com') && !l.website?.includes('instagram.com') && !l.website?.includes('linkedin.com')),
                    rating: l.totalScore || 0,
                    reviewsCount: l.reviewsCount || 0,
                    lat: l.location?.lat,
                    lng: l.location?.lng,
                    source: 'Google Maps'
                }));

                console.log(`Found ${processedLeads.length} total leads from Apify after deduplication.`);
                sendEvent({ source: 'Apify', leads: processedLeads });
                return processedLeads;
            } catch (err) {
                console.error("Apify Error:", err.message);
                return [];
            }
        })();
        sources.push(apifyPromise);
    } else {
        console.log("No APIFY_API_TOKEN found. Skipping Google Maps source.");
    }
    
    // 2. OpenStreetMap Overpass Source (Free)
    const overpassPromise = fetchFromOverpass(category, location).then(leads => {
        sendEvent({ source: 'OpenStreetMap', leads });
        return leads;
    }).catch(err => {
        console.error("Overpass error:", err);
        return [];
    });
    sources.push(overpassPromise);
    
    // 3. TomTom API Source (Free, No CC)
    if (process.env.TOMTOM_API_KEY) {
        const tomtomPromise = fetchFromTomTom(category, location).then(leads => {
            sendEvent({ source: 'TomTom', leads });
            return leads;
        }).catch(err => {
            console.error("TomTom error:", err);
            return [];
        });
        sources.push(tomtomPromise);
    } else {
        console.log("No TOMTOM_API_KEY found. Skipping TomTom source.");
    }
    
    // 4. Yelp Fusion Source (if key exists)
    if (process.env.YELP_API_KEY) {
        const yelpPromise = fetchFromYelp(category, location).then(leads => {
            sendEvent({ source: 'Yelp', leads });
            return leads;
        }).catch(err => {
            console.error("Yelp error:", err);
            return [];
        });
        sources.push(yelpPromise);
    }
    
    // 5. Google Places API Source (if key exists)
    if (process.env.GOOGLE_PLACES_API_KEY) {
        const googlePromise = fetchFromGooglePlaces(category, location).then(leads => {
            sendEvent({ source: 'Google Places', leads });
            return leads;
        }).catch(err => {
            console.error("Google Places error:", err);
            return [];
        });
        sources.push(googlePromise);
    }
    
    // Wait for all sources to finish
    try {
        await Promise.allSettled(sources);
    } finally {
        // Send final completion event
        sendEvent({ done: true });
        res.end();
    }
});

function getMockData(category, location) {
    return [
        { id: 1, name: `${category} Bros`, address: `100 Main St, ${location}`, phone: '(555) 111-2222', hasWebsite: false, rating: 4.5 },
        { id: 2, name: `${location} Local ${category}`, address: `250 Center Ave, ${location}`, phone: '(555) 333-4444', hasWebsite: false, rating: 4.8 },
        { id: 3, name: `Apex ${category} Services`, address: `500 Industrial Blvd, ${location}`, phone: '(555) 555-6666', hasWebsite: false, rating: 4.1 },
        { id: 4, name: `Reliable ${category} of ${location}`, address: `750 West St, ${location}`, phone: '(555) 777-8888', hasWebsite: false, rating: 4.9 },
    ];
}

async function fetchFromOverpass(category, location) {
    try {
        console.log(`Querying Overpass API for: ${category} in ${location}`);
        
        // Geocode the location first to get bounding box or area
        const nominatimUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=1`;
        const nomResponse = await axios.get(nominatimUrl, { headers: { 'User-Agent': 'B2BLeadFinder/1.0' }});
        
        if (!nomResponse.data || nomResponse.data.length === 0) {
            console.log(`Could not geocode location: ${location}`);
            return [];
        }
        
        // Use bbox instead of area for broader compat
        const bbox = nomResponse.data[0].boundingbox;
        const south = bbox[0];
        const north = bbox[1];
        const west = bbox[2];
        const east = bbox[3];
        
        // Search nodes, ways, relations with matching tags or names
        // Note: we do a text match on name/amenity/shop/office
        const overpassQuery = `
            [out:json][timeout:25];
            (
              nwr["name"~"${category}",i](${south},${west},${north},${east});
              nwr["amenity"~"${category}",i](${south},${west},${north},${east});
              nwr["shop"~"${category}",i](${south},${west},${north},${east});
              nwr["office"~"${category}",i](${south},${west},${north},${east});
              nwr["craft"~"${category}",i](${south},${west},${north},${east});
            );
            out center 100;
        `;
        
        const overpassUrl = 'https://overpass-api.de/api/interpreter';
        const response = await axios.post(overpassUrl, `data=${encodeURIComponent(overpassQuery)}`, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 30000
        });
        
        const elements = response.data.elements || [];
        
        const results = elements
            .filter(el => el.tags && el.tags.name)
            .map((el, index) => {
                const tags = el.tags;
                const lat = el.lat || (el.center && el.center.lat);
                const lon = el.lon || (el.center && el.center.lon);
                
                const addressParts = [
                    tags['addr:housenumber'],
                    tags['addr:street'],
                    tags['addr:city'],
                    tags['addr:state'],
                    tags['addr:postcode']
                ].filter(Boolean);
                
                const address = addressParts.length > 0 ? addressParts.join(', ') : location;
                const phone = tags['phone'] || tags['contact:phone'] || '';
                const websiteUrl = tags['website'] || tags['contact:website'] || '';
                const isSocialOnly = websiteUrl.includes('facebook.com') || websiteUrl.includes('instagram.com') || websiteUrl.includes('linkedin.com');
                const hasWebsite = websiteUrl !== '' && !isSocialOnly;
                
                return {
                    id: `osm-${el.id}`,
                    name: tags.name,
                    address: address,
                    phone: phone,
                    hasPhone: !!phone,
                    website: websiteUrl,
                    hasWebsite: hasWebsite,
                    rating: 0,
                    reviewsCount: 0,
                    lat: lat,
                    lng: lon,
                    source: 'OpenStreetMap'
                };
            });
            
        console.log(`Overpass API found ${results.length} leads.`);
        return results;
    } catch (error) {
        console.error("Error calling Overpass API:", error.message);
        return [];
    }
}

async function fetchFromTomTom(category, location) {
    const apiKey = process.env.TOMTOM_API_KEY;
    if (!apiKey) return [];
    
    try {
        console.log(`Querying TomTom API for: ${category} in ${location}`);
        const url = `https://api.tomtom.com/search/2/poiSearch/${encodeURIComponent(category + ' in ' + location)}.json?key=${apiKey}&limit=100`;
        const response = await axios.get(url, { timeout: 10000 });
        
        const results = response.data.results || [];
        
        return results.map(r => ({
            id: `tomtom-${r.id}`,
            name: r.poi?.name || 'Unknown Business',
            address: r.address?.freeformAddress || location,
            phone: r.poi?.phone || '',
            hasPhone: !!r.poi?.phone,
            website: r.poi?.url || '',
            hasWebsite: !!r.poi?.url,
            rating: 0, // TomTom doesn't typically provide ratings in this endpoint
            reviewsCount: 0,
            lat: r.position?.lat,
            lng: r.position?.lon,
            source: 'TomTom'
        }));
    } catch (error) {
        console.error("TomTom API Error:", error.message);
        return [];
    }
}

async function fetchFromYelp(category, location) {
    const apiKey = process.env.YELP_API_KEY;
    if (!apiKey) return [];
    
    try {
        console.log(`Querying Yelp Fusion API for: ${category} in ${location}`);
        const url = `https://api.yelp.com/v3/businesses/search?term=${encodeURIComponent(category)}&location=${encodeURIComponent(location)}&limit=50`;
        const response = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${apiKey}`
            }
        });
        
        const businesses = response.data.businesses || [];
        
        return businesses.map(b => ({
            id: `yelp-${b.id}`,
            name: b.name,
            address: b.location?.display_address?.join(', ') || location,
            phone: b.display_phone || b.phone || '',
            hasPhone: !!b.phone,
            website: b.url,
            hasWebsite: !!b.url,
            rating: b.rating || 0,
            reviewsCount: b.review_count || 0,
            lat: b.coordinates?.latitude,
            lng: b.coordinates?.longitude,
            source: 'Yelp'
        }));
    } catch (error) {
        console.error("Yelp API Error:", error.message);
        return [];
    }
}

async function fetchFromGooglePlaces(category, location) {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) return [];
    
    try {
        console.log(`Querying Google Places API for: ${category} in ${location}`);
        const url = 'https://places.googleapis.com/v1/places:searchText';
        const response = await axios.post(url, {
            textQuery: `${category} in ${location}`,
            languageCode: 'en'
        }, {
            headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': apiKey,
                'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.location'
            }
        });
        
        const places = response.data.places || [];
        
        return places.map(p => ({
            id: `google-${p.id}`,
            name: p.displayName?.text || 'Unknown Business',
            address: p.formattedAddress || location,
            phone: p.nationalPhoneNumber || '',
            hasPhone: !!p.nationalPhoneNumber,
            website: p.websiteUri || '',
            hasWebsite: !!p.websiteUri,
            rating: p.rating || 0,
            reviewsCount: p.userRatingCount || 0,
            lat: p.location?.latitude,
            lng: p.location?.longitude,
            source: 'Google Places API'
        }));
    } catch (error) {
        console.error("Google Places API Error:", error.message);
        return [];
    }
}

app.post('/api/audit', async (req, res) => {
    const { website } = req.body;
    if (!website) {
        return res.status(400).json({ error: 'Website URL is required' });
    }

    try {
        let validUrl = website;
        if (!validUrl.startsWith('http://') && !validUrl.startsWith('https://')) {
            validUrl = `https://${validUrl}`;
        }
        
        console.log(`Auditing website: ${validUrl}`);
        // Add a timeout to prevent hanging on slow websites, and a real User-Agent
        const response = await axios.get(validUrl, { 
            timeout: 10000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
        });
        const html = response.data;
        const $ = cheerio.load(html);
        
        // Remove scripts and styles to avoid false positives
        $('script, style').remove();
        const textContent = $('body').text();

        // Regex to find emails
        const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi;
        const matches = textContent.match(emailRegex) || [];
        
        // Clean up and deduplicate matches
        const uniqueEmails = [...new Set(matches.map(e => e.toLowerCase()))];
        // Filter out common false positives like image filenames (e.g. image@2x.png)
        const validEmails = uniqueEmails.filter(e => !e.endsWith('.png') && !e.endsWith('.jpg') && !e.endsWith('.webp') && !e.includes('sentry.io'));

        console.log(`Found emails: ${validEmails.join(', ')}`);
        
        // 2. Fetch Google PageSpeed Insights (Performance & SEO)
        let performanceScore = null;
        let seoScore = null;
        let errors = [];

        try {
            console.log("Fetching PageSpeed Insights...");
            // We request desktop strategy to make it faster and more relevant for B2B
            const psUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(website)}&category=PERFORMANCE&category=SEO&strategy=desktop`;
            
            // Set a generous timeout (20s) because PageSpeed can be slow
            const psResponse = await axios.get(psUrl, { timeout: 20000 });
            const lighthouse = psResponse.data.lighthouseResult;
            
            if (lighthouse && lighthouse.categories) {
                if (lighthouse.categories.performance) {
                    performanceScore = Math.round(lighthouse.categories.performance.score * 100);
                }
                if (lighthouse.categories.seo) {
                    seoScore = Math.round(lighthouse.categories.seo.score * 100);
                }

                // Extract a few notable errors/opportunities
                const audits = lighthouse.audits;
                if (audits) {
                    // Find Performance opportunities (where score is not perfect, usually numericValue > 0 means time wasted)
                    const speedErrors = Object.values(audits)
                        .filter(a => a.details && a.details.type === 'opportunity' && a.score !== 1 && a.score !== null)
                        .sort((a, b) => (b.details.overallSavingsMs || 0) - (a.details.overallSavingsMs || 0))
                        .slice(0, 2)
                        .map(a => `Speed: ${a.title}`);
                    
                    // Find SEO errors (score is 0)
                    const seoErrors = Object.values(audits)
                        .filter(a => a.score === 0 && (a.id.startsWith('seo') || a.id.includes('meta') || a.id.includes('link') || a.id.includes('heading')))
                        .slice(0, 2)
                        .map(a => `SEO: ${a.title}`);

                    errors = [...speedErrors, ...seoErrors];
                }
            }
        } catch (psError) {
            console.error(`PageSpeed Insights failed for ${validUrl}:`, psError.message);
            if (psError.response && psError.response.status === 429) {
                console.log("Google PageSpeed API rate limit reached. Using basic fallback audit silently.");
                // Remove the error push so it doesn't look like an error in the UI
            } else {
                errors.push("Failed to run full speed audit (timeout or inaccessible).");
            }
            
            // Basic HTML fallback for SEO
            try {
                let fallbackSeo = 100;
                if ($('title').length === 0 || $('title').text().trim().length === 0) {
                    errors.push("SEO: Missing <title> tag");
                    fallbackSeo -= 30;
                }
                if ($('meta[name="description"]').length === 0) {
                    errors.push("SEO: Missing meta description");
                    fallbackSeo -= 30;
                }
                if ($('h1').length === 0) {
                    errors.push("SEO: Missing <h1> tag");
                    fallbackSeo -= 20;
                }
                seoScore = fallbackSeo;
            } catch (fallbackErr) {
                console.error("Fallback SEO failed", fallbackErr);
            }
        }

        // 3. Fetch Decision Makers via APIs
        let decisionMakers = [];
        const domain = new URL(validUrl).hostname.replace('www.', '');
        const dmPromises = [];

        if (process.env.HUNTER_API_KEY) {
            const hunterPromise = (async () => {
                console.log("Fetching Hunter.io for decision makers...");
                const hunterUrl = `https://api.hunter.io/v2/domain-search?domain=${domain}&api_key=${process.env.HUNTER_API_KEY}`;
                const hunterResponse = await axios.get(hunterUrl, { timeout: 10000 });
                const emailsData = hunterResponse.data?.data?.emails || [];
                return emailsData.map(e => ({
                    name: e.first_name && e.last_name ? `${e.first_name} ${e.last_name}` : null,
                    email: e.value,
                    position: e.position || 'Employee',
                    linkedin: e.linkedin || null,
                    source: 'Hunter'
                })).filter(e => e.name);
            })();
            dmPromises.push(hunterPromise);
        }

        if (process.env.APOLLO_API_KEY) {
            const apolloPromise = (async () => {
                console.log("Fetching Apollo.io for decision makers...");
                const apolloUrl = `https://api.apollo.io/v1/mixed_people/search`;
                const apolloResponse = await axios.post(apolloUrl, {
                    api_key: process.env.APOLLO_API_KEY,
                    q_organization_domains: domain,
                    page: 1,
                    person_titles: ["ceo", "founder", "owner", "president", "director", "partner", "vp", "chief"]
                }, { timeout: 15000 });
                
                const people = apolloResponse.data?.people || [];
                return people.map(p => ({
                    name: p.first_name && p.last_name ? `${p.first_name} ${p.last_name}` : p.name,
                    email: p.email,
                    position: p.title || 'Decision Maker',
                    linkedin: p.linkedin_url || null,
                    source: 'Apollo'
                })).filter(e => e.name);
            })();
            dmPromises.push(apolloPromise);
        }

        if (dmPromises.length > 0) {
            try {
                const results = await Promise.allSettled(dmPromises);
                const combined = [];
                for (const result of results) {
                    if (result.status === 'fulfilled' && result.value) {
                        combined.push(...result.value);
                    } else if (result.status === 'rejected') {
                        console.error("DM API failed:", result.reason?.message || result.reason);
                        errors.push("A decision maker search failed.");
                    }
                }

                // Deduplicate by email/name
                const seenKeys = new Set();
                for (const dm of combined) {
                    const key = (dm.email || dm.name).toLowerCase();
                    if (!seenKeys.has(key)) {
                        seenKeys.add(key);
                        decisionMakers.push(dm);
                    }
                }
                console.log(`Found ${decisionMakers.length} unique decision makers from combined sources.`);
            } catch (err) {
                console.error("Error combining DM sources:", err.message);
            }
        }

        res.json({ 
            emails: validEmails,
            decisionMakers,
            performanceScore,
            seoScore,
            errors
        });
    } catch (error) {
        console.error(`Failed to audit ${website}:`, error.message);
        // If the main HTML fetch fails, return empty
        res.json({ emails: [], decisionMakers: [], performanceScore: null, seoScore: null, errors: ["Website could not be reached."] });
    }
});

app.post('/api/generate-pitch', async (req, res) => {
    try {
        const { lead, pitchType } = req.body;
        
        if (!lead || !lead.name) {
            return res.status(400).json({ error: 'Lead data is required' });
        }

        console.log(`Generating AI ${pitchType || 'email'} pitch for: ${lead.name}`);

        const baseContext = `
You are an expert B2B sales copywriter writing a cold outreach message to the owner of "${lead.name}".
Their address is: ${lead.address}.
They currently have a ${lead.rating} star rating based on ${lead.reviewsCount} reviews on Google Maps.

CRITICAL INSTRUCTIONS:
1. Do NOT use any placeholders like [Owner's Name], [Your Name], [Your Phone Number], etc.
2. We do not know the owner's name, so use a generic greeting like "Hi there" or "Hi team at ${lead.name}".
3. Always sign off the message with: "Apex".
`;

        const websiteContext = lead.hasWebsite
            ? `They currently HAVE a website, but your goal is to pitch a free audit of their website speed, mobile-friendliness, and SEO to help them get more customers.`
            : `They currently DO NOT have a website. Your goal is to pitch them a custom-built, affordable starter website to help them capture the traffic they deserve from their great reviews.`;

        const typeContext = pitchType === 'whatsapp'
            ? `Write a very short, friendly, and conversational WhatsApp message. Do NOT include a Subject line. Keep it under 3-4 sentences. Use emojis appropriately.`
            : `Write a professional, punchy cold email. You MUST include a "Subject: " line at the very beginning. Keep the body concise and persuasive.`;

        const pitchContext = `${baseContext}\n${websiteContext}\n${typeContext}`;

        const chatCompletion = await groq.chat.completions.create({
            messages: [{ role: 'user', content: pitchContext }],
            model: 'qwen/qwen3.8-27b', // Extremely fast and free model
            temperature: 0.7,
        });

        const generatedPitch = chatCompletion.choices[0]?.message?.content || '';
        res.json({ pitch: generatedPitch });
    } catch (error) {
        console.error('Groq API Error:', error);
        res.status(500).json({ error: 'Failed to generate pitch', details: error.message });
    }
});

// Search History Routes
app.get('/api/search-history', async (req, res) => {
    try {
        
        const history = await SearchHistory.find().sort({ timestamp: -1 }).limit(50);
        res.json(history);
    } catch (error) {
        console.error('Failed to fetch search history:', error);
        res.status(500).json({ error: 'Failed to fetch search history' });
    }
});

app.post('/api/search-history', async (req, res) => {
    try {
        const { location, category, resultsCount, leads } = req.body;
        const entry = new SearchHistory({ location, category, resultsCount, leads });
        await entry.save();
        res.json(entry);
    } catch (error) {
        console.error('Failed to save search history:', error);
        res.status(500).json({ error: 'Failed to save search history' });
    }
});

// Seen Leads Routes
app.get('/api/seen-leads', async (req, res) => {
    try {
        
        const seen = await SeenLead.find().sort({ timestamp: -1 });
        const record = {};
        seen.forEach(s => {
            record[s.leadId] = s.data;
        });
        res.json(record);
    } catch (error) {
        console.error('Failed to fetch seen leads:', error);
        res.status(500).json({ error: 'Failed to fetch seen leads' });
    }
});

app.post('/api/seen-leads', async (req, res) => {
    try {
        
        const { leadId, data } = req.body;
        // Upsert to handle duplicates
        const seen = await SeenLead.findOneAndUpdate(
            { leadId },
            { leadId, data },
            { upsert: true, new: true }
        );
        res.json(seen);
    } catch (error) {
        console.error('Failed to mark lead as seen:', error);
        res.status(500).json({ error: 'Failed to mark lead as seen' });
    }
});

app.delete('/api/seen-leads/:leadId', async (req, res) => {
    try {
        
        await SeenLead.findOneAndDelete({ leadId: req.params.leadId });
        res.json({ message: 'Removed from seen' });
    } catch (error) {
        console.error('Failed to unmark lead as seen:', error);
        res.status(500).json({ error: 'Failed to unmark lead as seen' });
    }
});

app.listen(PORT, () => {
    console.log(`Backend server running on http://localhost:${PORT}`);
});

module.exports = app;

// --- Database API Endpoints ---

// Get all saved leads
app.get('/api/leads', async (req, res) => {
    try {
        const leadsDocs = await Lead.find().sort({ createdAt: -1 });
        const leads = leadsDocs.map(doc => {
            const obj = doc.toObject();
            obj.id = obj._id;
            return obj;
        });
        res.json({ leads });
    } catch (error) {
        console.error('Failed to fetch leads:', error);
        res.status(500).json({ error: 'Failed to fetch leads' });
    }
});

// Save a lead
app.post('/api/leads', async (req, res) => {
    const { name, address, phone, website, rating, reviewsCount } = req.body;
    try {
        const newLead = new Lead({
            name: name || '',
            address: address || '',
            phone: phone || '',
            website: website || '',
            rating: rating || 0,
            reviewsCount: reviewsCount || 0
        });
        await newLead.save();
        res.json({ id: newLead._id, message: 'Lead saved successfully' });
    } catch (error) {
        console.error('Failed to save lead:', error);
        res.status(500).json({ error: 'Failed to save lead' });
    }
});

// Update lead status or notes
app.patch('/api/leads/:id', async (req, res) => {
    const { id } = req.params;
    const { status, responseNotes } = req.body;
    try {
        let updates = {};
        if (status !== undefined) updates.status = status;
        if (responseNotes !== undefined) updates.responseNotes = responseNotes;
        
        if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No fields to update' });
        
        await Lead.findByIdAndUpdate(id, updates);
        res.json({ message: 'Lead updated successfully' });
    } catch (error) {
        console.error('Failed to update lead:', error);
        res.status(500).json({ error: 'Failed to update lead' });
    }
});

// Delete a saved lead
app.delete('/api/leads/:id', async (req, res) => {
    try {
        await Lead.findByIdAndDelete(req.params.id);
        res.json({ message: 'Lead deleted successfully' });
    } catch (error) {
        console.error('Failed to delete lead:', error);
        res.status(500).json({ error: 'Failed to delete lead' });
    }
});

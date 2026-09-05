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

app.post('/api/scan', async (req, res) => {
    const { location, category, limit } = req.body;
    const maxPlaces = limit || 100;
    
    if (!location || !category) {
        return res.status(400).json({ error: 'Location and category are required' });
    }

    console.log(`Starting Apify scan for ${category} in ${location}...`);

    if (!APIFY_API_TOKEN) {
        console.log("No APIFY_API_TOKEN found in .env. Falling back to mock data.");
        await new Promise(resolve => setTimeout(resolve, 4000));
        return res.json({ leads: getMockData(category, location) });
    }

    try {
        // 1. Data Scraping Phase using Apify
        const query = `${category} in ${location}`;
        console.log(`Calling Apify (compass~crawler-google-places) for: ${query} with limit ${maxPlaces}`);
        
        // Prepare Actor input
        const input = {
            "searchStringsArray": [query],
            "maxCrawledPlacesPerSearch": maxPlaces,
            "language": "en",
            "maxImages": 0,
            "maxReviews": 0
        };

        // Run the Actor and wait for it to finish
        const run = await client.actor("compass~crawler-google-places").call(input);
        
        console.log(`Actor run finished. Fetching dataset: ${run.defaultDatasetId}`);

        // Fetch results from the dataset
        const { items } = await client.dataset(run.defaultDatasetId).listItems();
        
        // Filter out leads that are clearly from a different city/country due to Google Maps zoom-out
        const locationLower = location.toLowerCase();
        const locationParts = locationLower.split(/[\s,]+/).filter(p => p.length > 2);
        
        // Pass all leads to frontend so it can filter them dynamically
        const allLeads = items
            .map((business, index) => {
                const websiteUrl = business.website || '';
                const isSocialOnly = websiteUrl.includes('facebook.com') || websiteUrl.includes('instagram.com') || websiteUrl.includes('linkedin.com');
                const hasWebsite = websiteUrl !== '' && !isSocialOnly;
                
                return {
                    id: index,
                    name: business.title || 'Unknown Business',
                    address: business.address || business.city || location,
                    phone: business.phone || business.phoneUnformatted || '',
                    hasPhone: !!business.phone || !!business.phoneUnformatted,
                    website: websiteUrl,
                    hasWebsite: hasWebsite,
                    rating: business.totalScore || 0,
                    reviewsCount: business.reviewsCount || 0,
                    lat: business.location?.lat,
                    lng: business.location?.lng
                };
            })
            .filter(lead => {
                // Restore the filter to prevent random global results
                const addressLower = lead.address.toLowerCase();
                if (locationParts.length === 0) return true;
                return locationParts.some(part => addressLower.includes(part));
            });

        console.log(`Found ${allLeads.length} total leads. Sending to frontend.`);
        res.json({ leads: allLeads });
        
    } catch (error) {
        console.error("Error calling Apify API:", error.message);
        console.log("Falling back to mock data due to API error.");
        res.json({ leads: getMockData(category, location) });
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

        res.json({ 
            emails: validEmails,
            performanceScore,
            seoScore,
            errors
        });
    } catch (error) {
        console.error(`Failed to audit ${website}:`, error.message);
        // If the main HTML fetch fails, return empty
        res.json({ emails: [], performanceScore: null, seoScore: null, errors: ["Website could not be reached."] });
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

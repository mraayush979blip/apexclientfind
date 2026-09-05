import { useState, useMemo, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, Link } from 'react-router-dom';
import { Search, MapPin, Activity, Download, Plus, Star, Phone, Globe, SlidersHorizontal, ShieldAlert, Lock, Sparkles, Eye, EyeOff, History, ArrowRight } from 'lucide-react';
import './index.css';

// --- Components Defined OUTSIDE App ---

function Login({ onLogin }: { onLogin: (id: string, pass: string) => void }) {
  const [loginId, setLoginId] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onLogin(loginId, loginPassword);
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '24px' }}>
          <div style={{ background: 'var(--accent)', padding: '12px', borderRadius: '12px' }}>
            <Lock size={32} color="white" />
          </div>
        </div>
        <h2 style={{ marginBottom: '8px', fontSize: '24px' }}>Apex Login</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: '32px', fontSize: '14px' }}>Sign in to access B2B Lead Finder</p>
        
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="input-group">
            <input 
              type="text" 
              placeholder="Username" 
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
              style={{ paddingLeft: '16px' }}
              required
            />
          </div>
          <div className="input-group">
            <input 
              type="password" 
              placeholder="Password" 
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              style={{ paddingLeft: '16px' }}
              required
            />
          </div>
          <button type="submit" className="scan-btn" style={{ marginTop: '8px' }}>
            Sign In
          </button>
        </form>
      </div>
    </div>
  );
}

function Layout({ children, onLogout }: { children: React.ReactNode, onLogout: () => void }) {
  const location = useLocation();
  
  return (
    <div className="app-container">
      <nav className="top-nav">
        <div className="brand-nav">
          <div className="brand-icon"><Activity size={20} /></div>
          <h1>ApexClientFind <span style={{fontSize: '12px', fontWeight: 'normal', color: 'var(--text-muted)'}}>by Aayush</span></h1>
        </div>
        
        <div className="nav-links">
          <Link to="/" className={`nav-link ${location.pathname === '/' ? 'active' : ''}`}>
            <SlidersHorizontal size={16} /> Scanner
          </Link>
          <Link to="/saved" className={`nav-link ${location.pathname === '/saved' ? 'active' : ''}`}>
            <Star size={16} /> Saved Leads
          </Link>
          <Link to="/seen" className={`nav-link ${location.pathname === '/seen' ? 'active' : ''}`}>
            <Eye size={16} /> Seen
          </Link>
          <Link to="/searches" className={`nav-link ${location.pathname === '/searches' ? 'active' : ''}`}>
            <History size={16} /> Searches
          </Link>
        </div>

        <div className="nav-actions">
          <div className="user-profile">
            <div className="avatar">A</div>
            <span>Aayush</span>
            <button 
              onClick={onLogout} 
              style={{marginLeft: '12px', background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: '13px', cursor: 'pointer', fontWeight: 500}}
            >
              Logout
            </button>
          </div>
        </div>
      </nav>
      <div className="dashboard-layout">
        {children}
      </div>
    </div>
  );
}

function ProtectedRoute({ isLoggedIn, children }: { isLoggedIn: boolean, children: React.ReactNode }) {
  if (!isLoggedIn) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

function FetchOnMount({ onMount, children }: { onMount: () => void, children: React.ReactNode }) {
  useEffect(() => {
    onMount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <>{children}</>;
}

// --- Main App ---

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(() => {
    return localStorage.getItem('isLoggedIn') === 'true';
  });

  // Scanner States (Hoisted so they persist during navigation)
  const [isScanning, setIsScanning] = useState(false);
  const [locationStr, setLocationStr] = useState('');
  const [category, setCategory] = useState('');
  const [maxLeads, setMaxLeads] = useState(50);
  const [leads, setLeads] = useState<any[]>([]);
  const [lastScanQuery, setLastScanQuery] = useState({ location: '', category: '' });
  
  const [filterNoWebsite, setFilterNoWebsite] = useState(false);
  const [filterLowReviews, setFilterLowReviews] = useState(false);
  const [filterNoPhone, setFilterNoPhone] = useState(false);
  const [filterHideSeen, setFilterHideSeen] = useState(false);

  const [seenLeads, setSeenLeads] = useState<Record<string, any>>({});
  const [searchHistory, setSearchHistory] = useState<any[]>([]);

  useEffect(() => {
    if (isLoggedIn) {
      // Fetch seen leads
      fetch('/api/seen-leads')
        .then(res => res.json())
        .then(data => {
            if (data && !data.error) setSeenLeads(data);
        })
        .catch(err => console.error(err));

      // Fetch search history
      fetch('/api/search-history')
        .then(res => res.json())
        .then(data => {
            if (Array.isArray(data)) setSearchHistory(data);
        })
        .catch(err => console.error(err));
    }
  }, [isLoggedIn]);

  // Saved Leads States
  const [savedLeads, setSavedLeads] = useState<any[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(false);

  // Audit / Pitch States
  const [auditingIds, setAuditingIds] = useState<string[]>([]);
  const [auditResults, setAuditResults] = useState<Record<string, any>>({});
  const [pitchingIds, setPitchingIds] = useState<string[]>([]);
  const [pitches, setPitches] = useState<Record<string, string>>({});
  const [pitchTypes, setPitchTypes] = useState<Record<string, 'email' | 'whatsapp'>>({});

  // Local state for searches view so it doesn't break input focus in App
  const [selectedSearch, setSelectedSearch] = useState<any | null>(null);

  const handleLogin = (id: string, pass: string) => {
    if (id.trim().toLowerCase() === 'apexstride' && pass === 'apex2026') {
      setIsLoggedIn(true);
      localStorage.setItem('isLoggedIn', 'true');
    } else {
      alert('Invalid credentials');
    }
  };

  const handleLogout = () => {
    setIsLoggedIn(false);
    localStorage.removeItem('isLoggedIn');
  };

  // API Calls
  const handleScan = async () => {
    if (!locationStr) return;
    setIsScanning(true);
    
    const isSameQuery = lastScanQuery.location === locationStr && lastScanQuery.category === category;
    if (!isSameQuery) {
        setLeads([]);
    }
    
    try {
      const response = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location: locationStr, category: category || 'Business', limit: maxLeads }) 
      });
      const data = await response.json();
      
      const processedLeads = (data.leads || []).map((l: any, idx: number) => ({
          ...l,
          id: l.id || `lead-${Date.now()}-${idx}`
      }));
      
      setLeads(prev => {
          if (!isSameQuery) return processedLeads;
          // Deduplicate by name
          const existingNames = new Set(prev.map(p => p.name));
          const newLeads = processedLeads.filter((l: any) => !existingNames.has(l.name));
          return [...prev, ...newLeads];
      });
      
      setLastScanQuery({ location: locationStr, category: category });

      // Save to Search History (limit 15)
      setSearchHistory(prev => {
          const newHistory = [
              {
                  id: Date.now().toString(),
                  location: locationStr,
                  category: category || 'Business',
                  timestamp: new Date().toISOString(),
                  leads: processedLeads
              },
              ...prev
          ].slice(0, 15);
          fetch('/api/search-history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ location: locationStr, category: industry, resultsCount: processedLeads.length })
          }).catch(console.error);
          return newHistory;
      });

    } catch (error) {
      console.error('Error connecting to scanner API:', error);
      alert("Failed to connect to the backend scanner.");
    } finally {
      setIsScanning(false);
    }
  };

  const handleMarkSeen = async (lead: any) => {
    const isSeen = !!seenLeads[lead.id];
    setSeenLeads(prev => {
        const updated = { ...prev };
        if (isSeen) {
            delete updated[lead.id];
        } else {
            updated[lead.id] = lead;
        }
        return updated;
    });

    try {
        if (isSeen) {
            await fetch(`/api/seen-leads/${lead.id}`, { method: 'DELETE' });
        } else {
            await fetch('/api/seen-leads', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ leadId: lead.id, data: lead })
            });
        }
    } catch (error) {
        console.error('Error updating seen lead:', error);
    }
  };

  const fetchSavedLeads = async () => {
    setLoadingSaved(true);
    try {
      const response = await fetch('/api/leads');
      const data = await response.json();
      setSavedLeads(data.leads || []);
    } catch (error) {
      console.error('Error fetching saved leads:', error);
    } finally {
      setLoadingSaved(false);
    }
  };

  const handleSaveLead = async (lead: any) => {
    try {
      const response = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lead)
      });
      if (response.ok) {
        alert(`${lead.name} saved successfully!`);
      }
    } catch (error) {
      console.error('Error saving lead:', error);
      alert('Failed to save lead.');
    }
  };

  const handleUpdateSavedLead = async (id: string, updates: any) => {
    setSavedLeads(prev => prev.map(l => l.id === id ? { ...l, ...updates } : l));
    try {
      await fetch(`/api/leads/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
    } catch (error) {
      console.error('Error updating lead:', error);
    }
  };

  const handleDeleteSavedLead = async (id: string) => {
    if (!confirm('Are you sure you want to delete this lead?')) return;
    setSavedLeads(prev => prev.filter(l => l.id !== id));
    try {
      await fetch(`/api/leads/${id}`, { method: 'DELETE' });
    } catch (error) {
      console.error('Error deleting lead:', error);
    }
  };

  const handleAudit = async (lead: any) => {
    if (!lead.website) {
        alert("This business doesn't have a website to audit.");
        return;
    }
    setAuditingIds(prev => [...prev, lead.id]);
    try {
        const response = await fetch('/api/audit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ website: lead.website })
        });
        const data = await response.json();
        setAuditResults(prev => ({ ...prev, [lead.id]: data }));
    } catch (error) {
        setAuditResults(prev => ({ ...prev, [lead.id]: { emails: [], errors: ["Failed to run audit."] } }));
    } finally {
        setAuditingIds(prev => prev.filter(id => id !== lead.id));
    }
  };

  const handleGeneratePitch = async (lead: any, type: 'email' | 'whatsapp') => {
    setPitchingIds(prev => [...prev, lead.id]);
    setPitchTypes(prev => ({ ...prev, [lead.id]: type }));
    try {
        const response = await fetch('/api/generate-pitch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lead, pitchType: type })
        });
        const data = await response.json();
        setPitches(prev => ({ ...prev, [lead.id]: data.pitch || 'Failed to generate pitch.' }));
    } catch (error) {
        setPitches(prev => ({ ...prev, [lead.id]: 'Error communicating with AI server.' }));
    } finally {
        setPitchingIds(prev => prev.filter(id => id !== lead.id));
    }
  };

  const handleExportCSV = (exportLeads: any[]) => {
    if (exportLeads.length === 0) return;
    const headers = ['Business Name,Phone Number,Address,Website,Reviews Count,Rating,Emails'];
    const csvData = exportLeads.map(lead => {
        const emails = auditResults[lead.id]?.emails ? auditResults[lead.id].emails.join('; ') : '';
        return `"${lead.name}","${lead.phone}","${lead.address}","${lead.website}",${lead.reviewsCount},${lead.rating},"${emails}"`;
    });
    const csvString = [...headers, ...csvData].join('\n');
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `apex_leads.csv`;
    link.click();
  };

  // Filters
  const filteredLeads = useMemo(() => {
    return leads.filter(lead => {
      if (filterHideSeen && seenLeads[lead.id]) return false;
      if (filterNoWebsite && lead.hasWebsite) return false;
      if (filterNoPhone && lead.hasPhone) return false;
      if (filterLowReviews && lead.reviewsCount > 5) return false;
      return true;
    });
  }, [leads, filterNoWebsite, filterNoPhone, filterLowReviews, filterHideSeen, seenLeads]);

  // Lead Card Component (Rendered as JSX to avoid hook rules violation when mapped)
  const renderLeadCard = (lead: any, hideActions = false) => (
    <div key={lead.id} style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: 'var(--bg-panel)', borderRadius: '12px', border: '1px solid var(--border)' }}>
      <div className="lead-card-h" style={{ border: 'none', margin: 0 }}>
        <div className="lead-info-h">
          <div className="lead-title-row">
            <h3>{lead.name}</h3>
            <div className="tags-row">
              {!lead.hasWebsite ? (
                  <span className="tag tag-red">NO WEBSITE</span>
              ) : (
                  <a href={lead.website.startsWith('http') ? lead.website : `https://${lead.website}`} target="_blank" rel="noreferrer" className="tag tag-green" style={{textDecoration: 'none'}}>HAS WEBSITE ↗</a>
              )}
              {lead.hasPhone ? <span className="tag tag-blue">HAS PHONE</span> : <span className="tag tag-gray">NO PHONE</span>}
              <span className="tag tag-gray">{lead.reviewsCount} reviews</span>
            </div>
            {lead.rating > 0 && (
              <div className="lead-rating"><Star size={14} fill="currentColor"/> {lead.rating}</div>
            )}
            {seenLeads[lead.id] && (
                <span className="tag tag-gray" style={{display: 'flex', alignItems: 'center', gap: '4px'}}><Eye size={12}/> SEEN</span>
            )}
          </div>
          
          <div className="lead-address">
            <MapPin size={12}/> {lead.address}
          </div>
          
          <div className="action-buttons" style={{marginTop: '4px'}}>
            {lead.hasPhone && <button className="btn-crm" style={{color: '#2563EB', borderColor: '#BFDBFE'}}><Phone size={12}/> {lead.phone}</button>}
            {!lead.hasWebsite && <button className="btn-crm" style={{color: '#DC2626', borderColor: '#FECACA'}}><Globe size={12}/> No website</button>}
          </div>
        </div>

        {!hideActions && (
            <div className="lead-actions-h">
            <div className="action-buttons">
                <button className="btn-audit" onClick={() => handleMarkSeen(lead)} style={{ color: seenLeads[lead.id] ? 'var(--text-muted)' : 'var(--text-main)' }}>
                    {seenLeads[lead.id] ? <><EyeOff size={14}/> Unmark Seen</> : <><Eye size={14}/> Mark Seen</>}
                </button>
                <button className="btn-audit" onClick={() => handleSaveLead(lead)}>
                    <Plus size={14}/> Save Lead
                </button>
                <button className="btn-audit" onClick={() => handleGeneratePitch(lead, 'email')} disabled={pitchingIds.includes(lead.id)}>
                    {pitchingIds.includes(lead.id) && pitchTypes[lead.id] === 'email' ? 'Generating...' : <><Sparkles size={14}/> Email</>}
                </button>
                <button className="btn-audit btn-audit-success" onClick={() => handleGeneratePitch(lead, 'whatsapp')} disabled={pitchingIds.includes(lead.id)}>
                    {pitchingIds.includes(lead.id) && pitchTypes[lead.id] === 'whatsapp' ? 'Generating...' : <><Phone size={14}/> WhatsApp</>}
                </button>
                {lead.hasWebsite && auditResults[lead.id] === undefined && (
                    <button className="btn-audit btn-audit-primary" onClick={() => handleAudit(lead)} disabled={auditingIds.includes(lead.id)}>
                        {auditingIds.includes(lead.id) ? 'Auditing...' : <><ShieldAlert size={14}/> Audit Site</>}
                    </button>
                )}
            </div>
            </div>
        )}
      </div>
      
      {pitches[lead.id] && (
          <div className="pitch-box">
              <h4 style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px'}}>
                  <span style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                      <Sparkles size={14} color="var(--accent)"/> Generated {pitchTypes[lead.id] === 'whatsapp' ? 'WhatsApp' : 'Email'} Pitch
                  </span>
              </h4>
              <textarea
                  style={{ width: '100%', minHeight: '100px', background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: '13px', resize: 'vertical' }}
                  value={pitches[lead.id]}
                  onChange={(e) => setPitches(prev => ({ ...prev, [lead.id]: e.target.value }))}
              />
          </div>
      )}

      {auditResults[lead.id] && (
          <div className="pitch-box" style={{ background: 'rgba(59, 130, 246, 0.05)', borderColor: 'rgba(59, 130, 246, 0.2)' }}>
              <h4 style={{display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', color: '#2563EB'}}>
                  <ShieldAlert size={14} /> Full Site Audit Report
              </h4>
              
              <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
                  {auditResults[lead.id].performanceScore !== null && (
                      <div className={`tag ${auditResults[lead.id].performanceScore >= 90 ? 'tag-green' : auditResults[lead.id].performanceScore >= 50 ? 'tag-gray' : 'tag-red'}`}>
                          Speed Score: {auditResults[lead.id].performanceScore}/100
                      </div>
                  )}
                  {auditResults[lead.id].seoScore !== null && (
                      <div className={`tag ${auditResults[lead.id].seoScore >= 90 ? 'tag-green' : auditResults[lead.id].seoScore >= 50 ? 'tag-gray' : 'tag-red'}`}>
                          SEO Score: {auditResults[lead.id].seoScore}/100
                      </div>
                  )}
              </div>

              {auditResults[lead.id].errors && auditResults[lead.id].errors.length > 0 && (
                  <div style={{ marginBottom: '12px' }}>
                      <strong style={{ fontSize: '13px', color: 'var(--text-main)', marginBottom: '4px', display: 'block' }}>Key Issues Found:</strong>
                      <ul style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0, paddingLeft: '20px' }}>
                          {auditResults[lead.id].errors.map((err: string, i: number) => (
                              <li key={i}>{err}</li>
                          ))}
                      </ul>
                  </div>
              )}

              {auditResults[lead.id].emails && auditResults[lead.id].emails.length > 0 ? (
                  <div>
                      <strong style={{ fontSize: '13px', color: 'var(--text-main)', marginBottom: '4px', display: 'block' }}>Scraped Emails:</strong>
                      <div className="tags-row">
                          {auditResults[lead.id].emails.map((e: string, i: number) => (
                              <span key={i} className="tag tag-blue" style={{textTransform: 'none'}}>{e}</span>
                          ))}
                      </div>
                  </div>
              ) : (
                  <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No emails found on the homepage.</span>
              )}
          </div>
      )}
    </div>
  );


  // JSX Variables for Views (Solves focus loss by preventing component unmount on re-render)
  const scannerContent = (
    <>
      <aside className="sidebar">
        <div className="search-section">
          <div className="input-group" style={{ marginBottom: '12px' }}>
            <MapPin className="input-icon" size={16} />
            <input 
              type="text" 
              placeholder="Target Location" 
              value={locationStr}
              onChange={(e) => setLocationStr(e.target.value)}
            />
          </div>
          <div className="input-group">
            <Search className="input-icon" size={16} />
            <input 
              type="text" 
              placeholder="Industry" 
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
          </div>
          <div className="input-group" style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Max Leads:</span>
            <select 
              value={maxLeads}
              onChange={(e) => setMaxLeads(Number(e.target.value))}
              style={{ flex: 1, background: 'transparent', border: 'none', color: 'var(--text-main)', outline: 'none', fontSize: '13px' }}
            >
              <option value={20}>20 Leads</option>
              <option value={50}>50 Leads</option>
              <option value={100}>100 Leads</option>
              <option value={200}>200 Leads</option>
              <option value={500}>500 Leads (Slower)</option>
            </select>
          </div>
        </div>

        <div className="filter-section">
          <div className={`filter-item ${filterNoWebsite ? 'active' : ''}`} onClick={() => setFilterNoWebsite(!filterNoWebsite)}>
            <div className="filter-info">
              <h4>No Website</h4>
              <p>Verified via GMB + search</p>
            </div>
            <div className="toggle-switch"><div className="toggle-knob"></div></div>
          </div>
          <div className={`filter-item ${filterLowReviews ? 'active' : ''}`} onClick={() => setFilterLowReviews(!filterLowReviews)}>
            <div className="filter-info">
              <h4>Low Reviews</h4>
              <p>Below review threshold (≤ 5)</p>
            </div>
            <div className="toggle-switch"><div className="toggle-knob"></div></div>
          </div>
          <div className={`filter-item ${filterNoPhone ? 'active' : ''}`} onClick={() => setFilterNoPhone(!filterNoPhone)}>
            <div className="filter-info">
              <h4>No Phone</h4>
              <p>Verified across GMB</p>
            </div>
            <div className="toggle-switch"><div className="toggle-knob"></div></div>
          </div>
          <div className={`filter-item ${filterHideSeen ? 'active' : ''}`} onClick={() => setFilterHideSeen(!filterHideSeen)}>
            <div className="filter-info">
              <h4>Hide Seen Leads</h4>
              <p>Hide leads you marked as seen</p>
            </div>
            <div className="toggle-switch"><div className="toggle-knob"></div></div>
          </div>
        </div>

        <button 
          className="scan-btn"
          onClick={handleScan}
          disabled={isScanning || !locationStr}
        >
          {isScanning ? (
            <><span className="loading-spinner"></span> Scraping Leads...</>
          ) : (lastScanQuery.location === locationStr && lastScanQuery.category === category && leads.length > 0) ? (
            'Show More ↓'
          ) : (
            'Start Scanning →'
          )}
        </button>
      </aside>

      <main className="main-content">
        <div className="content-header">
          <div className="header-title-row">
            <div>
              <h2>{filteredLeads.length} Leads</h2>
              <p>{category || 'Business'} • {locationStr} • Generated from live scan</p>
            </div>
            <div className="header-actions">
              <button className="btn-secondary" onClick={() => handleExportCSV(filteredLeads)}><Download size={14}/> CSV Export</button>
            </div>
          </div>

          <div className="stats-row">
            <div className="stat-card">
              <h3>{leads.length}</h3>
              <p>Total Leads Found</p>
            </div>
            <div className="stat-card accent">
              <h3>{leads.filter(l => !l.hasWebsite && l.hasPhone).length}</h3>
              <p>Hot Leads (No Web + Phone)</p>
            </div>
            <div className="stat-card accent-blue">
              <h3>{leads.filter(l => !l.hasWebsite).length}</h3>
              <p>No Website</p>
            </div>
            <div className="stat-card">
              <h3>{leads.filter(l => l.reviewsCount <= 5).length}</h3>
              <p>Low Reviews</p>
            </div>
          </div>
        </div>

        <div className="leads-container">
          {filteredLeads.map(lead => renderLeadCard(lead))}

          {!isScanning && leads.length === 0 && (
            <div style={{textAlign: 'center', marginTop: '40px', color: 'var(--text-muted)'}}>
              <h2 style={{marginTop: '20px', color: 'var(--text-main)'}}>Ready to generate leads</h2>
              <p>Enter a location and industry, then click Start Scanning.</p>
            </div>
          )}
        </div>
      </main>
    </>
  );

  const savedLeadsContent = (
    <FetchOnMount onMount={fetchSavedLeads}>
      <main className="main-content" style={{ maxWidth: '100%' }}>
        <div className="content-header">
          <h2>Saved Leads Pipeline</h2>
          <p>Manage and track outreach for your saved contacts</p>
        </div>
        
        <div style={{ background: 'var(--bg-panel)', borderRadius: '12px', border: '1px solid var(--border)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: 'var(--bg-main)', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '16px', fontWeight: 600, color: 'var(--text-muted)', fontSize: '12px', textTransform: 'uppercase' }}>Business</th>
                <th style={{ padding: '16px', fontWeight: 600, color: 'var(--text-muted)', fontSize: '12px', textTransform: 'uppercase' }}>Contact</th>
                <th style={{ padding: '16px', fontWeight: 600, color: 'var(--text-muted)', fontSize: '12px', textTransform: 'uppercase' }}>Status</th>
                <th style={{ padding: '16px', fontWeight: 600, color: 'var(--text-muted)', fontSize: '12px', textTransform: 'uppercase' }}>Notes</th>
                <th style={{ padding: '16px', fontWeight: 600, color: 'var(--text-muted)', fontSize: '12px', textTransform: 'uppercase' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {savedLeads.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    {loadingSaved ? 'Loading leads...' : 'No saved leads yet. Go scan and save some!'}
                  </td>
                </tr>
              ) : (
                savedLeads.map(lead => (
                  <tr key={lead.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '16px', verticalAlign: 'top' }}>
                      <strong style={{color: 'var(--text-main)'}}>{lead.name}</strong><br/>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{lead.address}</span>
                    </td>
                    <td style={{ padding: '16px', verticalAlign: 'top' }}>
                      {lead.phone && <div style={{ fontSize: '13px', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}><Phone size={12}/> {lead.phone}</div>}
                      {lead.website && <div style={{ fontSize: '13px', color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: '4px' }}><Globe size={12}/> <a href={lead.website.startsWith('http') ? lead.website : `https://${lead.website}`} target="_blank" rel="noreferrer" style={{color: 'inherit', textDecoration: 'none'}}>{lead.website}</a></div>}
                    </td>
                    <td style={{ padding: '16px', verticalAlign: 'top' }}>
                      <select 
                        style={{ 
                          background: 'white', 
                          color: 'var(--text-main)', 
                          border: '1px solid var(--border)', 
                          borderRadius: '6px', 
                          padding: '8px',
                          fontSize: '13px',
                          outline: 'none',
                          width: '100%',
                          maxWidth: '180px'
                        }}
                        value={lead.status}
                        onChange={(e) => handleUpdateSavedLead(lead.id, { status: e.target.value })}
                      >
                        <option value="Not Messaged">Not Messaged</option>
                        <option value="Message Sent">Message Sent</option>
                        <option value="Response Received">Response Received</option>
                        <option value="Not Interested">Not Interested</option>
                        <option value="Closed">Closed</option>
                      </select>
                    </td>
                    <td style={{ padding: '16px', verticalAlign: 'top' }}>
                      <textarea
                        placeholder="Add response notes..."
                        style={{
                          width: '100%',
                          minHeight: '60px',
                          background: 'white',
                          color: 'var(--text-main)',
                          border: '1px solid var(--border)',
                          borderRadius: '6px',
                          padding: '8px',
                          fontSize: '13px',
                          resize: 'vertical',
                          outline: 'none'
                        }}
                        value={lead.responseNotes || ''}
                        onChange={(e) => setSavedLeads(prev => prev.map(l => l.id === lead.id ? { ...l, responseNotes: e.target.value } : l))}
                        onBlur={(e) => handleUpdateSavedLead(lead.id, { responseNotes: e.target.value })}
                      />
                    </td>
                    <td style={{ padding: '16px', verticalAlign: 'top' }}>
                      <button 
                        onClick={() => handleDeleteSavedLead(lead.id)}
                        style={{ padding: '6px 12px', color: 'var(--error)', border: '1px solid #FECACA', background: '#FEF2F2', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', fontWeight: 500 }}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>
    </FetchOnMount>
  );

  const seenArray = Object.values(seenLeads);
  const seenContent = (
    <main className="main-content">
      <div className="content-header">
        <div className="header-title-row">
          <div>
            <h2>{seenArray.length} Seen Leads</h2>
            <p>Businesses you've marked as seen across all searches</p>
          </div>
          <div className="header-actions">
            <button className="btn-secondary" onClick={() => handleExportCSV(seenArray)}><Download size={14}/> CSV Export</button>
          </div>
        </div>
      </div>
      <div className="leads-container">
        {seenArray.length === 0 ? (
            <div style={{textAlign: 'center', marginTop: '40px', color: 'var(--text-muted)'}}>
              <h2 style={{marginTop: '20px', color: 'var(--text-main)'}}>No seen leads yet</h2>
              <p>Click "Mark Seen" on a lead to add it here.</p>
            </div>
        ) : (
          seenArray.map((lead: any) => renderLeadCard(lead))
        )}
      </div>
    </main>
  );

  const searchesContent = selectedSearch ? (
      <main className="main-content">
          <div className="content-header">
              <button className="btn-secondary" onClick={() => setSelectedSearch(null)} style={{marginBottom: '16px'}}>← Back to Searches</button>
              <div className="header-title-row">
                  <div>
                  <h2>{selectedSearch.category} in {selectedSearch.location}</h2>
                  <p>{new Date(selectedSearch.timestamp).toLocaleString()} • {selectedSearch.leads.length} Leads Found</p>
                  </div>
                  <div className="header-actions">
                  <button className="btn-secondary" onClick={() => handleExportCSV(selectedSearch.leads)}><Download size={14}/> CSV Export</button>
                  </div>
              </div>
          </div>
          <div className="leads-container">
              {selectedSearch.leads.map((lead: any) => renderLeadCard(lead))}
          </div>
      </main>
  ) : (
    <main className="main-content">
      <div className="content-header">
        <h2>Search History</h2>
        <p>Your 15 most recent scans and their results</p>
      </div>
      <div className="leads-container">
        {searchHistory.length === 0 ? (
            <div style={{textAlign: 'center', marginTop: '40px', color: 'var(--text-muted)'}}>
              <h2 style={{marginTop: '20px', color: 'var(--text-main)'}}>No searches yet</h2>
              <p>Go to the Scanner and find some leads to build your history.</p>
            </div>
        ) : (
          searchHistory.map((search: any) => (
              <div key={search.id} style={{ padding: '20px', background: 'var(--bg-panel)', borderRadius: '12px', border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                      <h3 style={{fontSize: '18px', color: 'var(--text-main)', marginBottom: '4px'}}>{search.category} in {search.location}</h3>
                      <p style={{fontSize: '13px', color: 'var(--text-muted)'}}>{new Date(search.timestamp).toLocaleString()} • {search.leads.length} leads</p>
                  </div>
                  <button className="btn-audit" onClick={() => setSelectedSearch(search)}>
                      View Leads <ArrowRight size={14}/>
                  </button>
              </div>
          ))
        )}
      </div>
    </main>
  );

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={
          isLoggedIn ? <Navigate to="/" replace /> : <Login onLogin={handleLogin} />
        } />
        
        <Route path="/" element={
          <ProtectedRoute isLoggedIn={isLoggedIn}>
            <Layout onLogout={handleLogout}>
              {scannerContent}
            </Layout>
          </ProtectedRoute>
        } />
        
        <Route path="/saved" element={
          <ProtectedRoute isLoggedIn={isLoggedIn}>
            <Layout onLogout={handleLogout}>
              {savedLeadsContent}
            </Layout>
          </ProtectedRoute>
        } />

        <Route path="/seen" element={
          <ProtectedRoute isLoggedIn={isLoggedIn}>
            <Layout onLogout={handleLogout}>
              {seenContent}
            </Layout>
          </ProtectedRoute>
        } />

        <Route path="/searches" element={
          <ProtectedRoute isLoggedIn={isLoggedIn}>
            <Layout onLogout={handleLogout}>
              {searchesContent}
            </Layout>
          </ProtectedRoute>
        } />

        {/* Fallback route */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;

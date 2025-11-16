import Layout from "./Layout.jsx";

import Landing from "./Landing";

import Onboarding from "./Onboarding";

import Dashboard from "./Dashboard";

import KnowledgeBase from "./KnowledgeBase";

import LiveSession from "./LiveSession";

import Analytics from "./Analytics";

import Settings from "./Settings";

import AdminPanel from "./AdminPanel";

import ZoomConnect from "./ZoomConnect";

import ImplementationGuide from "./ImplementationGuide";

import Documentation from "./Documentation";

import HostMeeting from "./HostMeeting";

import DesktopAppCode from "./DesktopAppCode";

import { BrowserRouter as Router, Route, Routes, useLocation } from 'react-router-dom';

const PAGES = {
    
    Landing: Landing,
    
    Onboarding: Onboarding,
    
    Dashboard: Dashboard,
    
    KnowledgeBase: KnowledgeBase,
    
    LiveSession: LiveSession,
    
    Analytics: Analytics,
    
    Settings: Settings,
    
    AdminPanel: AdminPanel,
    
    ZoomConnect: ZoomConnect,
    
    ImplementationGuide: ImplementationGuide,
    
    Documentation: Documentation,
    
    HostMeeting: HostMeeting,
    
    DesktopAppCode: DesktopAppCode,
    
}

function _getCurrentPage(url) {
    if (url.endsWith('/')) {
        url = url.slice(0, -1);
    }
    let urlLastPart = url.split('/').pop();
    if (urlLastPart.includes('?')) {
        urlLastPart = urlLastPart.split('?')[0];
    }

    const pageName = Object.keys(PAGES).find(page => page.toLowerCase() === urlLastPart.toLowerCase());
    return pageName || Object.keys(PAGES)[0];
}

// Create a wrapper component that uses useLocation inside the Router context
function PagesContent() {
    const location = useLocation();
    const currentPage = _getCurrentPage(location.pathname);
    
    return (
        <Layout currentPageName={currentPage}>
            <Routes>            
                
                    <Route path="/" element={<Landing />} />
                
                
                <Route path="/Landing" element={<Landing />} />
                
                <Route path="/Onboarding" element={<Onboarding />} />
                
                <Route path="/Dashboard" element={<Dashboard />} />
                
                <Route path="/KnowledgeBase" element={<KnowledgeBase />} />
                
                <Route path="/LiveSession" element={<LiveSession />} />
                
                <Route path="/Analytics" element={<Analytics />} />
                
                <Route path="/Settings" element={<Settings />} />
                
                <Route path="/AdminPanel" element={<AdminPanel />} />
                
                <Route path="/ZoomConnect" element={<ZoomConnect />} />
                
                <Route path="/ImplementationGuide" element={<ImplementationGuide />} />
                
                <Route path="/Documentation" element={<Documentation />} />
                
                <Route path="/HostMeeting" element={<HostMeeting />} />
                
                <Route path="/DesktopAppCode" element={<DesktopAppCode />} />
                
            </Routes>
        </Layout>
    );
}

export default function Pages() {
    return (
        <Router>
            <PagesContent />
        </Router>
    );
}
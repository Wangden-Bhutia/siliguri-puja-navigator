"""Playwright e2e for Siliguri Puja Guide — 3-tab UX (schema v2).
Usage: python tests/e2e.py [BASE_URL]   (default http://127.0.0.1:8777/siliguri-puja-navigator/)
Env: SHOTS=<dir>. Uses system Chrome. No invented approved traffic; DEMO records only."""
import base64, json, os, sys
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import pngpx
from playwright.sync_api import sync_playwright

args=[a for a in sys.argv[1:] if not a.startswith('--')]
BASE=(args[0] if args else 'http://127.0.0.1:8777/siliguri-puja-navigator/').rstrip('/')+'/'
SHOTS=os.environ.get('SHOTS','/workspace/spn-shots-v3/').rstrip('/')+'/'
os.makedirs(SHOTS,exist_ok=True)
PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')
results=[]
def ok(name,cond,info=''):
    results.append((name,bool(cond)))
    print(('PASS ' if cond else 'FAIL ')+name+((' | '+str(info)[:400]) if (info!='' and not cond) else ''))

def rects_overlap(a,b):
    if not a or not b: return False
    return not (a['x']+a['width']<=b['x'] or b['x']+b['width']<=a['x'] or a['y']+a['height']<=b['y'] or b['y']+b['height']<=a['y'])

with sync_playwright() as p:
    b=p.chromium.launch(channel='chrome',headless=True)
    def new_ctx(w=390,h=844,sw='block'):
        c=b.new_context(viewport={'width':w,'height':h},is_mobile=True,has_touch=True,device_scale_factor=2,service_workers=sw)
        c.route('https://tile.openstreetmap.org/**',lambda r: r.fulfill(status=200,content_type='image/png',body=PNG))
        return c
    def watch(pg,store):
        pg.on('console',lambda m: store.append(m.type+': '+m.text) if m.type=='error' else None)
        pg.on('pageerror',lambda e: store.append('PAGEERROR '+str(e)))
    def goto(pg,route=''):
        pg.goto(BASE+'index.html'+('#/'+route if route else ''))
        pg.wait_for_function("window.PujaApp && PujaApp.counts().pandals>0",timeout=15000)
        pg.wait_for_timeout(400)
    def go(pg,route,wait=450):
        pg.evaluate("r=>{location.hash='#/'+r}",route); pg.wait_for_timeout(wait)
    def visible_view(pg):
        return pg.evaluate("[...document.querySelectorAll('.view')].filter(v=>!v.hidden).map(v=>v.dataset.view).join(',')")

    # ============ main journeys @390 ============
    ctx=new_ctx(); pg=ctx.new_page(); errs=[]; watch(pg,errs)
    goto(pg)
    c=pg.evaluate("PujaApp.counts()")
    ok('data loaded: 83 pandals / 28 neighbourhoods', c['pandals']==83 and c['neighbourhoods']==28, c)
    ok('home visible', visible_view(pg)=='home')
    tabs=pg.eval_on_selector_all('#tabbar a','els=>els.map(e=>e.innerText.trim().replace(/\\s+/g," "))')
    ok('exactly 3 tabs: Home / Pandals / Parking & Traffic', len(tabs)==3 and 'Home' in tabs[0] and 'Pandals' in tabs[1] and 'Parking' in tabs[2] and 'Traffic' in tabs[2], tabs)
    ok('tabbar visible after load', pg.is_visible('#tabbar'))
    ok('SOS fab visible on home', pg.is_visible('#sos-fab'))
    ok('home freshness shows Updated', 'Updated' in pg.inner_text('#home-fresh') or 'outdated' in pg.inner_text('#home-fresh'), pg.inner_text('#home-fresh'))
    ok('install chip hidden by default', pg.locator('#install-btn').count()==1 and pg.is_hidden('#install-btn'))
    pg.evaluate("""() => {
      const fake = { prompt: function(){ window.__spnInstallPrompted = (window.__spnInstallPrompted||0)+1; return Promise.resolve({outcome:'accepted'}); } };
      PujaApp._setDeferredInstall(fake);
    }""")
    pg.wait_for_timeout(150)
    ok('install chip visible when deferred install available', pg.is_visible('#install-btn'))
    pg.click('#install-btn'); pg.wait_for_timeout(200)
    ok('install chip prompts and hides after click', pg.evaluate('window.__spnInstallPrompted||0')>=1 and pg.is_hidden('#install-btn'))
    # also fire real beforeinstallprompt-shaped path
    pg.evaluate("""() => {
      window.__spnBip = 0;
      const e = new Event('beforeinstallprompt');
      e.preventDefault = function(){};
      e.prompt = function(){ window.__spnBip++; return Promise.resolve({}); };
      window.dispatchEvent(e);
    }""")
    pg.wait_for_timeout(150)
    ok('beforeinstallprompt shows install chip again', pg.is_visible('#install-btn'))
    ok('install card visible with chip after beforeinstallprompt', pg.is_visible('#install-card') and 'Install Siliguri Puja Guide' in pg.inner_text('#install-card') and 'full-screen, offline use' in pg.inner_text('#install-card'))
    pg.click('#install-card-btn'); pg.wait_for_timeout(200)
    ok('install card button calls prompt() and hides card + chip', pg.evaluate('window.__spnBip')==1 and pg.is_hidden('#install-card') and pg.is_hidden('#install-btn'))
    pg.evaluate("PujaApp._setDeferredInstall({prompt:function(){return Promise.resolve({})}})"); pg.wait_for_timeout(100)
    ok('install card re-shows when prompt available again', pg.is_visible('#install-card'))
    pg.click('#install-card-x'); pg.wait_for_timeout(100)
    ok('install card X hides card, keeps footer chip', pg.is_hidden('#install-card') and pg.is_visible('#install-btn'))
    ok('install card dismissal stored in localStorage', int(pg.evaluate("localStorage.getItem('spn.installDismissedAt')||0"))>0)
    pg.evaluate("PujaApp._setDeferredInstall({prompt:function(){return Promise.resolve({})}})"); pg.wait_for_timeout(100)
    ok('install card stays hidden within 3 days of dismissal', pg.is_hidden('#install-card'))
    pg.evaluate("localStorage.setItem('spn.installDismissedAt', String(Date.now()-3*864e5-1000))")
    pg.evaluate("PujaApp._setDeferredInstall({prompt:function(){return Promise.resolve({})}})"); pg.wait_for_timeout(100)
    ok('install card re-shows after 3 days', pg.is_visible('#install-card'))
    pg.evaluate("window.dispatchEvent(new Event('appinstalled'))"); pg.wait_for_timeout(100)
    ok('appinstalled hides install card and chip', pg.is_hidden('#install-card') and pg.is_hidden('#install-btn'))
    go(pg,'pandals',300)
    pg.evaluate("PujaApp._setDeferredInstall({prompt:function(){return Promise.resolve({})}})"); pg.wait_for_timeout(100)
    ok('install card only on Home', pg.is_hidden('#install-card'))
    pg.evaluate("PujaApp._setDeferredInstall(null)"); go(pg,'',300)

    ok('home single warn card', pg.locator('#view-home .warn-card').count()==1)
    ok('demo banner: locations confirmed, parking/traffic finalising', 'pandal locations are confirmed' in pg.inner_text('#status-banners').lower() and 'traffic & parking plan' in pg.inner_text('#status-banners').lower() and 'parking' in pg.inner_text('#status-banners').lower() and 'order' not in pg.inner_text('#status-banners').lower() and 'DEMO' not in pg.inner_text('#status-banners'))
    ok('identity strip hidden while branding not approved', pg.is_hidden('#idstrip') and pg.locator('#idstrip-logos img').count()==0)
    ok('neutral descriptor, no "Official" claim while unapproved', pg.text_content('#brand-descriptor')=='Durga Puja Visitor Information · Siliguri' and 'official' not in pg.inner_text('body').lower())
    ok('home: title, tagline, dates', ' '.join(pg.inner_text('#brand-name').split())=='Siliguri Puja Guide' and pg.inner_text('#brand-tag')=='Find pandals. Plan your route. Travel safely.' and '16 – 24 October 2026' in pg.inner_text('#brand-dates'))
    ok('home: 3 actions only, primary Find a Pandal', pg.locator('#view-home a.bigbtn').count()==3 and 'Find a Pandal' in pg.inner_text('#view-home a.bigbtn-primary'))
    ok('home: no stats/counts', not __import__('re').search(r'\b\d+ (pandals|neighbourhoods)\b', pg.inner_text('#view-home')))
    ok('icons are monochrome SVG (no "P"/emoji text icons)', pg.locator('#tabbar svg.ic').count()==3 and pg.locator('#view-home .bigbtn svg.bi').count()==3 and pg.locator('#view-home .bigbtn svg.chev').count()==3 and pg.locator('#sos-fab svg.ic').count()==1 and not pg.evaluate("[...document.querySelectorAll('.bi,.ti')].some(e=>e.tagName!=='svg')"))
    ok('parking icon is a car line icon, not a letter P', pg.locator('#tabbar a[data-tab="parking"] use[href="#i-car"]').count()==1 and pg.locator('#view-home a[data-go="parking"] use[href="#i-car"]').count()==1 and pg.locator('use[href="#i-park"]').count()==0 and pg.locator('#i-park').count()==0 and pg.locator('#i-car text').count()==0 and pg.locator('#i-car circle').count()==2)
    ok('icons use currentColor stroke', pg.evaluate("getComputedStyle(document.querySelector('#tabbar svg.ic')).stroke")==pg.evaluate("getComputedStyle(document.querySelector('#tabbar a')).color"))
    ok('theme button has short visible mode label + accessible name', pg.is_visible('#theme-btn .theme-lbl') and (pg.get_attribute('#theme-btn','aria-label') or '').startswith('Theme: '))
    ok('footer says Demo version', 'Demo version' in pg.inner_text('#foot-line'))
    pg.screenshot(path=SHOTS+'home-390.png',full_page=False)

    # J1 Home -> Find Pandal
    pg.click('#view-home a.bigbtn-primary'); pg.wait_for_timeout(400)
    ok('J1 Home→Find Pandal: pandals view', visible_view(pg)=='pandals')
    n_items=pg.locator('#nhood-list li').count()
    ok('no page-level neighbourhood/pandal count line', pg.is_hidden('#filter-summary') and pg.text_content('#filter-summary')=='')
    ok('Pandals default = neighbourhood list (28)', n_items==28 and pg.is_hidden('#pandal-search-list'), n_items)
    first=pg.inner_text('#nhood-list li:first-child')
    ok('neighbourhood item shows count', 'pandal' in first, first)
    pg.screenshot(path=SHOTS+'pandals-390.png')

    # search switches to flat list
    pg.fill('#q','Dada'); pg.wait_for_timeout(250)
    ok('search shows flat results', pg.is_visible('#pandal-search-list') and pg.is_hidden('#nhood-list') and pg.locator('#pandal-search-list .pandal-card').count()>=1)
    card=pg.inner_text('#pandal-search-list .pandal-card >> nth=0')
    ok('card minimal: name+locality+Location confirmed, no coords/source', 'Dada Bhai' in card and 'Deshbandhupara' in card and 'Location confirmed' in card and 'Field-checked' not in card and 'Approved' not in card and 'Pujo Songi' not in card and '26.7' not in card, card)
    ok('no "verified" claim on card', 'Verified' not in card.replace('verification',''), card)
    pg.fill('#q',''); pg.wait_for_timeout(200)
    ok('clearing search restores neighbourhoods', pg.is_visible('#nhood-list'))

    # J2 Home -> Parking & Walking
    go(pg,'')
    pg.click('#view-home a[data-go="parking"]'); pg.wait_for_timeout(500)
    ok('J2 Home→Parking: parking panel', visible_view(pg)=='parking' and pg.is_visible('#panel-parking') and pg.is_hidden('#panel-traffic'))
    pk=pg.inner_text('#parking-list')
    ok('parking lead question', 'Where do I leave my vehicle?' in pg.inner_text('#panel-parking'))
    ok('parking: 15 named 2026 places, no DEMO', pg.locator('#parking-list .info-card').count()==15 and 'DEMO' not in pk and 'Railway Institute Ground' in pk and 'Dhaknikata' in pk, pk[:200])
    ok('parking rules: no roadside parking + towing, press tag', pg.is_visible('#parking-rules') and 'towed' in pg.inner_text('#parking-rules') and 'Per local press reports' in pg.inner_text('#parking-rules'))
    ok('parking: no document references', all(w not in pg.inner_text('#panel-parking') for w in ['order','Order','notification','Memo','dated']))
    ok('parking empty note hidden', pg.is_hidden('#parking-empty'))
    ok('parking tab current', pg.get_attribute('#tabbar a[data-tab="parking"]','aria-current')=='page')

    # J3 Home -> Traffic
    go(pg,'')
    pg.click('#view-home a[data-go="traffic"]'); pg.wait_for_timeout(500)
    ok('J3 Home→Traffic: traffic panel', visible_view(pg)=='parking' and pg.is_visible('#panel-traffic') and pg.get_attribute('#sub-traffic','aria-selected')=='true')
    tx=pg.inner_text('#panel-traffic')
    ok('2025 baseline year never shown to visitors', '2025' not in tx, tx[:300])
    ok('historical TP25 labels not shown', 'TP25' not in tx and 'Junction side' not in tx)
    ok('restricted roads section present (2026 plan)', 'Roads closed to vehicles' in tx and 'Bidhan Road' in tx and 'Payal More' in tx)
    ok('9 restricted-road cards with Puja 2026 plan badge', pg.locator('#traffic-planned .info-card').count()==9 and pg.locator('#traffic-planned .badge-approved').count()==9)
    ok('no pending badge left on traffic layer', '2026 traffic arrangement pending verification' not in tx)
    ok('plan hours card', pg.is_visible('#traffic-plan') and '4 PM' in pg.inner_text('#traffic-plan') and '24 Oct' in pg.inner_text('#traffic-plan') and 'Immersion' in pg.inner_text('#traffic-plan'))
    ok('no source-document wording on traffic panel', 'C.O.' not in tx and 'Memo' not in tx and ' order' not in tx.lower() and 'notification' not in tx.lower() and 'IPS' not in tx and 'Commissioner' not in tx)
    ok('routes + buses section', 'Routes & bus departure points' in tx and 'Naukaghat' in tx and 'Mittal' in tx and pg.locator('#traffic-diversions .info-card').count()==12)
    ok('goods entry points: 6 cards, 3 mapped', pg.locator('#traffic-controls .info-card').count()==6 and pg.locator('#map-traffic .mk-ctrl').count()==3 and 'Sukna' in tx)
    ok('traffic caveat present', 'Traffic arrangements and timings may change at short notice' in tx and 'approximate' in tx.lower())
    pg.locator('#traffic-planned .info-card:has-text("Bidhan Road") button:has-text("View on Map")').click(); pg.wait_for_timeout(400)
    ok('View on Map draws approx segment markers', pg.locator('#map-traffic .mk-traf').count()>=2)
    ok('text-only rows have no map button', pg.locator('#traffic-planned .info-card:has-text("Payal More") button').count()==0)
    ok('data: 29 traffic nodes', pg.evaluate("()=>PujaApp.state().data.trafficNodes.length")==29)
    ok('data: none confirmed2026', pg.evaluate("()=>[...PujaApp.state().data.trafficRestrictions,...PujaApp.state().data.trafficControls,...PujaApp.state().data.trafficDiversions].every(r=>!r.confirmed2026)"))
    ok('PAB unchanged 18 mapped', pg.evaluate("()=>PujaApp.state().data.facilities.filter(f=>f.type==='police-booth'&&!f.demo).length")==18)
    ok('83 pandals unchanged', pg.evaluate("()=>PujaApp.state().data.pandals.length")==83)
    # J8 Active now on a Puja night (2026 plan window)
    pg.fill('#t-date','2026-10-17'); pg.dispatch_event('#t-date','change')
    pg.fill('#t-time','19:30'); pg.dispatch_event('#t-time','change'); pg.wait_for_timeout(250)
    act=pg.inner_text('#traffic-active')
    ok('J8 active: plan window shown in Active now', pg.locator('#traffic-active li').count()==1 and '16' in act and 'What to do:' in act and 'PM' in act, act)
    ok('DEMO traffic block hidden (no samples left)', pg.is_hidden('#demo-traffic-block'))
    ok('traffic card hides source', 'source' not in act.lower() and 'order no' not in act.lower() and 'C.O.' not in act)
    pg.fill('#t-time','10:00'); pg.dispatch_event('#t-time','change'); pg.wait_for_timeout(200)
    ok('daytime: nothing active, next window upcoming', pg.locator('#traffic-active li').count()==0 and pg.locator('#traffic-real-upcoming li').count()>=1)
    pg.fill('#t-date','2026-10-26'); pg.dispatch_event('#t-date','change'); pg.wait_for_timeout(200)
    ok('after immersion period: no active, no upcoming', pg.locator('#traffic-active li').count()==0 and pg.is_hidden('#traffic-real-upcoming-wrap'))
    ok('expired 2025 records never in visitor feed', '2025' not in pg.inner_text('#panel-traffic') and 'TP25' not in pg.inner_text('#panel-traffic') and 'Jhankar' not in pg.inner_text('#panel-traffic'))

    # J4 Pandals -> Neighbourhood -> Pandal
    go(pg,'pandals')
    pg.click('#nhood-list a:has-text("Deshbandhupara")'); pg.wait_for_timeout(600)
    ok('J4a neighbourhood view', visible_view(pg)=='nhood' and pg.inner_text('#nhood-title')=='Deshbandhupara')
    ok('nhood count 5 pandals', '5 pandals' in pg.inner_text('#nhood-count'))
    ok('nhood map shows only its pandals (5 markers)', pg.locator('#map-nhood .mk-pandal').count()==5, pg.locator('#map-nhood .mk-pandal').count())
    ok('nhood list 5 cards', pg.locator('#nhood-pandal-list .pandal-card').count()==5)
    pg.click('#nhood-pandal-list .pandal-card:has-text("Dada Bhai") a:has-text("View")'); pg.wait_for_timeout(600)
    ok('J4b pandal detail', visible_view(pg)=='pandal' and 'Dada Bhai' in pg.inner_text('#pandal-title'))
    det=pg.inner_text('#view-pandal')
    ok('pandal detail: Location confirmed (never Field-checked/Approved)', 'Location confirmed' in pg.inner_text('#pandal-status') and 'Field-checked' not in det and 'Approved' not in det and 'Verified' not in det.replace('NOT VERIFIED',''))
    ok('pandal detail: parking/traffic finalising note', 'See Parking & Traffic for 2026 parking places.' in pg.inner_text('#pandal-status'))
    ok('confirmed pandal Directions builds Google Maps URL', pg.evaluate("()=>{const p=PujaApp.state().data.pandals.find(x=>x.id==='SG26-001');return !!PujaLogic.mapsDirUrl(p)}") and True)
    ok('confirmed location does NOT auto fieldVerified', pg.evaluate("()=>{const p=PujaApp.state().data.pandals.find(x=>x.id==='SG26-001');return p.locationStatus==='confirmed' && p.verificationStatus==='pendingVerification' && !PujaLogic.isCheckedLocation(p.verificationStatus) && PujaLogic.isLocationConfirmed(p)}"))
    ok('pandal detail order: name, locality, badge, Directions before map', pg.evaluate("(()=>{const a=document.querySelector('#pandal-actions'),m=document.querySelector('#map-pandal');return !!(a.compareDocumentPosition(m)&Node.DOCUMENT_POSITION_FOLLOWING)})()") and pg.locator('#pandal-actions button:has-text("Directions")').count()==1)
    ok('pandal detail sections Get there/Traffic', 'Get there' in det and 'Traffic' in det)
    ok('pandal detail: small contextual map (pandal + its parking only)', pg.locator('#map-pandal .mk-pandal').count()==1 and pg.locator('#map-pandal .mk-park').count()==0 and pg.locator('#map-pandal').bounding_box()['height']<=170)
    ok('pandal detail no source/coords', 'Pujo Songi' not in det and '26.71' not in det)
    ok('pandal detail: link to 2026 parking places', pg.locator('#pandal-parking a[href="#/parking"]:has-text("See 2026 parking places")').count()==1)
    # J6 Pandal -> Parking
    pkd=pg.inner_text('#pandal-parking')
    ok('J6 Pandal→Parking: no DEMO parking on pandal page', 'DEMO' not in pkd and 'No parking place is linked' in pkd, pkd[:300])
    ok('pandal traffic empty-state copy', 'No published traffic restriction is currently associated with this pandal.' in pg.inner_text('#pandal-traffic'))
    # Nearby help: mapped PABs within 2 km of Dada Bhai (e.g. Venus More) — show real distance, not fabricated
    ok('pandal nearby help shows mapped PABs within 2 km', pg.is_visible('#pandal-help-h') and pg.is_visible('#pandal-help') and 'Police Assistance Booth' in pg.inner_text('#pandal-help') and 'Location mapped' in pg.inner_text('#pandal-help') and 'Mapped landmark' in pg.inner_text('#pandal-help'))
    ok('pandal nearby help has Directions', pg.locator('#pandal-help button:has-text("Directions")').count()>=1)
    pg.screenshot(path=SHOTS+'pandal-390.png',full_page=True)

    # J5 Pandal -> Directions (nav-sheet once, then Google Maps)
    popups=[]
    ctx.on('page',lambda np: popups.append(np))
    pg.click('#pandal-actions button:has-text("Directions")'); pg.wait_for_timeout(300)
    ok('J5 nav-sheet opens with Google Maps warning', pg.is_visible('#nav-sheet') and 'Google Maps may not reflect' in pg.inner_text('#nav-sheet'))
    href=pg.get_attribute('#nav-go','href')
    ok('nav link is maps dir url', href.startswith('https://www.google.com/maps/dir/?api=1&destination=26.7118'), href)
    nb=pg.locator('#nav-sheet .sheet-inner').bounding_box()
    ok('nav-sheet anchored to bottom', nb and abs((nb['y']+nb['height'])-844)<=2, nb)
    pg.click('#nav-sheet button[value="cancel"]'); pg.wait_for_timeout(200)
    ok('cancel closes nav-sheet', not pg.is_visible('#nav-sheet'))
    ok('Google Maps warning not on regular screens', 'Google Maps may not reflect' not in pg.inner_text('main'))

    go(pg,'parking')
    ok('map markers carry no text letters', pg.evaluate("[...document.querySelectorAll('.mk')].every(m=>m.textContent==='')"))

    # history back
    go(pg,'pandals'); go(pg,'n/hakimpara')
    pg.go_back(); pg.wait_for_timeout(400)
    ok('history back works', visible_view(pg)=='pandals')

    # J9 SOS -> 112
    pg.click('#sos-fab'); pg.wait_for_timeout(300)
    ok('J9 SOS sheet opens', pg.is_visible('#sos-sheet'))
    sos=pg.inner_text('#sos-sheet')
    ok('SOS 112 call link', pg.get_attribute('#sos-list a[href^="tel:"]','href')=='tel:112')
    ok('SOS control rooms: Puja 2026 PCR number callable, traffic CR still to be confirmed', sos.count('Number to be confirmed for 2026')==1 and '0353-2662210' in sos and pg.locator('#sos-list a[href^="tel:"]').count()==2, sos)
    ib=pg.locator('#sos-sheet .sheet-inner').bounding_box()
    ok('SOS is a bottom sheet (anchored to bottom)', ib and abs((ib['y']+ib['height'])-844)<=2, ib)
    order=pg.eval_on_selector_all('#sos-list .sos-label','els=>els.map(e=>e.textContent.trim())')
    ok('SOS priority order', order==['112','Police Control Room','Traffic Control Room','Police Assistance Booths','Hospitals'], order)
    ok('SOS has no toilets/water/first aid', not any(x in sos.lower() for x in ['toilet','water','first aid']))
    ok('SOS fab aria-expanded', pg.get_attribute('#sos-fab','aria-expanded')=='true')
    pg.screenshot(path=SHOTS+'sos-390.png')
    # J10 SOS -> PAB
    pg.click('#sos-list a[href="#/facilities/pab"]'); pg.wait_for_timeout(500)
    ok('J10 SOS→PAB facilities view', visible_view(pg)=='facilities' and 'Police Assistance Booths' in pg.inner_text('#fac-title') and not pg.is_visible('#sos-sheet'))
    fac=pg.inner_text('#fac-list')
    ok('PAB DEMO card still present and labelled DEMO', 'DEMO' in fac and 'Sample Police Assistance Booth' in fac)
    ok('18 mapped PAB markers (mk-pab), demo uses mk-fac', pg.locator('#map-facilities .mk-pab').count()==18 and pg.locator('#map-facilities .mk-fac').count()==1, [pg.locator('#map-facilities .mk-pab').count(), pg.locator('#map-facilities .mk-fac').count()])
    ok('mapped PAB card: Location mapped + landmark note', 'Location mapped' in fac and 'Mapped landmark' in fac and 'Airview More' in fac)
    ok('mapped PABs not labelled DEMO', pg.evaluate("""()=>{const cards=[...document.querySelectorAll('#fac-list .info-card')].filter(c=>!c.classList.contains('is-demo'));return cards.length===18 && cards.every(c=>!/DEMO/.test(c.innerText) && /Location mapped/.test(c.innerText))}"""))
    ok('PAB Directions present for mapped booths', pg.locator('#fac-list .info-card:not(.is-demo) button:has-text("Directions")').count()==18)
    # Directions opens nav sheet for a mapped PAB
    pg.locator('#fac-list .info-card:not(.is-demo) button:has-text("Directions")').first.click(); pg.wait_for_timeout(300)
    ok('mapped PAB Directions opens nav-sheet', pg.is_visible('#nav-sheet') and 'Google Maps may not reflect' in pg.inner_text('#nav-sheet'))
    href_pab=pg.get_attribute('#nav-go','href')
    ok('mapped PAB nav link is Google Maps dir', href_pab and href_pab.startswith('https://www.google.com/maps/dir/?api=1&destination='), href_pab)
    pg.click('#nav-sheet button[value="cancel"]'); pg.wait_for_timeout(200)
    ok('no Champasari Sri Guru fabricated PAB', 'Bidyamandir' not in fac and 'Champasari Sri Guru' not in fac)
    # J11 SOS -> Hospital
    pg.click('#sos-fab'); pg.wait_for_timeout(300)
    pg.click('#sos-list a[href="#/facilities/hospital"]'); pg.wait_for_timeout(500)
    ok('J11 SOS→Hospital', 'Hospitals' in pg.inner_text('#fac-title') and 'DEMO' in pg.inner_text('#fac-list'))

    alltext=''
    for r in ['','pandals','n/deshbandhupara','p/SG26-001','parking','parking/traffic','facilities/pab','facilities/hospital','info/safety','info/privacy','info/terms']:
        go(pg,r,350); alltext+=pg.inner_text('body')
    ok('no toilets / drinking water / first aid anywhere visitor-facing', not __import__('re').search(r'toilet|drinking water|first.aid', alltext, __import__('re').I))
    ok('no "Official" claim anywhere visitor-facing while unapproved', 'official' not in alltext.lower())
    # info pages
    go(pg,'info/privacy')
    ok('info privacy', pg.inner_text('#info-title')=='Privacy policy')

    # no 'verified' claim anywhere in visible pandal UI
    go(pg,'pandals'); pg.fill('#q','a'); pg.wait_for_timeout(300)
    allc=pg.inner_text('#pandal-search-list')
    ok('no card says Verified', 'Verified' not in allc and 'Police verified' not in allc)
    pg.fill('#q','')
    ok('no console errors (main run)', not errs, errs)
    ctx.close()

    # ============ viewports 360 / 390 / 412: overlap + hscroll ============
    for theme,(w,h) in [(t,v) for t in ('light','dark') for v in [(360,780),(390,844),(412,915)]]:
        ctx=new_ctx(w,h); ctx.add_init_script(f"localStorage.setItem('spn.theme','{theme}')"); pg=ctx.new_page(); e2=[]; watch(pg,e2)
        for route in ['','pandals','n/siliguri-town','p/SG26-001','parking','parking/traffic','facilities/pab']:
            goto(pg,route) if route=='' else go(pg,route,550)
            hs=pg.evaluate("document.documentElement.scrollWidth>innerWidth")
            ok(f'{theme} {w}px #{route or "/"} no horizontal scroll', not hs)
            fab=pg.locator('#sos-fab').bounding_box(); bar=pg.locator('#tabbar').bounding_box()
            ok(f'{theme} {w}px #{route or "/"} SOS above tabbar (no overlap)', fab and bar and not rects_overlap(fab,bar) and fab['y']+fab['height']<=bar['y'], [fab,bar])
            # scroll to bottom: last actionable control should not be hidden under fab/tabbar
            pg.evaluate("window.scrollTo(0,document.body.scrollHeight)"); pg.wait_for_timeout(150)
            covered=pg.evaluate("""()=>{const fab=document.querySelector('#sos-fab').getBoundingClientRect();const bar=document.querySelector('#tabbar').getBoundingClientRect();
              const els=[...document.querySelectorAll('.view:not([hidden]) a, .view:not([hidden]) button, .footlinks a')].filter(e=>e.offsetParent);
              const last=els[els.length-1]; if(!last) return null; const r=last.getBoundingClientRect();
              const ov=(a,b)=>!(a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top);
              return ov(r,fab)||ov(r,bar)?{t:last.textContent.trim().slice(0,40),r:[r.top,r.bottom,r.left,r.right]}:null}""")
            ok(f'{theme} {w}px #{route or "/"} last control reachable (not under SOS/tabbar)', covered is None, covered)
            if route in ('p/SG26-001',):
                zc=pg.locator('#map-pandal .leaflet-control-zoom').bounding_box()
                pg.evaluate("document.querySelector('#map-pandal').scrollIntoView({block:'center'})"); pg.wait_for_timeout(100)
                zc=pg.locator('#map-pandal .leaflet-control-zoom').bounding_box(); fab=pg.locator('#sos-fab').bounding_box()
                ok(f'{theme} {w}px map zoom controls not under SOS', not rects_overlap(zc,fab), [zc,fab])
        # touch targets
        go(pg,'')
        small=pg.evaluate("""[...document.querySelectorAll('#tabbar a, #sos-fab, .bigbtn, #theme-btn')].filter(e=>e.offsetParent||e.id==='sos-fab').map(e=>{const r=e.getBoundingClientRect();return [e.id||e.className,r.width,r.height]}).filter(x=>x[1]<44||x[2]<44)""")
        ok(f'{theme} {w}px touch targets ≥44px', not small, small)
        # Home secondary labels on one line
        go(pg,'',300)
        wraps=pg.evaluate("()=>[...document.querySelectorAll('.bigrow .bt')].map(e=>[e.textContent,e.getClientRects().length,Math.round(e.getBoundingClientRect().height)<=Math.round(parseFloat(getComputedStyle(e).lineHeight))+1,parseFloat(getComputedStyle(e).fontSize)])")
        ok(f'{theme} {w}px "Parking & Walking" fits one line, font >=15px', all(x[2] and x[3]>=15 for x in wraps), wraps)
        # End of content clears the SOS FAB and tab bar when scrolled to bottom
        def last_card_clear(route,setup=None):
            go(pg,route,450)
            if setup: setup()
            pg.evaluate("window.scrollTo(0,document.documentElement.scrollHeight)"); pg.wait_for_timeout(200)
            return pg.evaluate("""()=>{const v=document.querySelector('.view:not([hidden])');const cards=[...v.querySelectorAll('.info-card,.pandal-card')].filter(c=>c.offsetParent);
              if(!cards.length) return 'nocard';const c=cards[cards.length-1];const fab=document.querySelector('#sos-fab').getBoundingClientRect(),bar=document.querySelector('#tabbar').getBoundingClientRect();
              const ov=(a,b)=>!(a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top);
              const parts=[...c.querySelectorAll('button,a,p,h3,span')].filter(e=>e.offsetParent);
              const hit=parts.filter(e=>{const r=e.getBoundingClientRect();return ov(r,fab)||ov(r,bar)}).map(e=>e.textContent.trim().slice(0,30));
              return hit.length?hit:null}""")
        def tset():
            pg.fill('#t-date','2026-10-17'); pg.dispatch_event('#t-date','change'); pg.fill('#t-time','19:30'); pg.dispatch_event('#t-time','change'); pg.wait_for_timeout(200)
        for route,setup in [('parking/traffic',tset),('parking',None),('n/siliguri-town',None),('p/SG26-001',None),('facilities/pab',None)]:
            res=last_card_clear(route,setup)
            ok(f'{theme} {w}px #{route} last card text/buttons clear of SOS FAB + tab bar at bottom', res is None, res)
        # SOS sheet fully inside the viewport
        go(pg,''); pg.click('#sos-fab'); pg.wait_for_timeout(300)
        sb=pg.locator('#sos-sheet .sheet-inner').bounding_box()
        ok(f'{theme} {w}px SOS sheet within viewport', sb and sb['x']>=0 and sb['y']>=0 and sb['x']+sb['width']<=w+0.5 and sb['y']+sb['height']<=h+0.5, sb)
        pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
        # keyboard focus ring visible on key controls
        fv=pg.evaluate("""()=>{const out=[];for(const s of ['#view-home a.bigbtn-primary','#theme-btn','#sos-fab','#tabbar a[data-tab=pandals]']){const e=document.querySelector(s);e.focus();}return true}""")
        rings=[]
        for sel in ['#theme-btn','#view-home a.bigbtn-primary','#tabbar a[data-tab="pandals"]','#sos-fab']:
            pg.evaluate("document.activeElement&&document.activeElement.blur()")
            pg.focus(sel); pg.keyboard.press('Shift'); 
            st=pg.evaluate("s=>{const e=document.querySelector(s);const c=getComputedStyle(e);return [e.matches(':focus-visible'),c.outlineStyle,parseFloat(c.outlineWidth)]}",sel)
            rings.append((sel,st))
        ok(f'{theme} {w}px focus-visible ring visible on key controls', all(r[1][1]!='none' and r[1][2]>=2 for r in rings), rings)
        # pressed state: normal -> subtle pressed -> normal, never transparent/vanishing, never near-white in dark
        cdp=ctx.new_cdp_session(pg); pressed=[]
        for route,sel in [('','#view-home a.bigbtn-primary'),('','#view-home a[data-go="parking"]'),('','#tabbar a[data-tab="pandals"]'),('parking','#sub-traffic'),('parking','#sub-parking')]:
            go(pg,route,350)
            loc=pg.locator(sel).first; loc.scroll_into_view_if_needed(); bb=loc.bounding_box()
            q="s=>{const e=document.querySelector(s);const c=getComputedStyle(e);return [c.backgroundColor,c.opacity,c.visibility]}"
            css=sel.split(' >> ')[0].replace(':has-text(\"Walking route\")','') if 'Walking' in sel else sel
            if 'Walking' in sel: css='#parking-list .pc-actions button:nth-child(2)'
            n0=pg.evaluate(q,css)
            cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':bb['x']+bb['width']/2,'y':bb['y']+bb['height']/2}]}); pg.wait_for_timeout(80)
            n1=pg.evaluate(q,css)
            cdp.send('Input.dispatchTouchEvent',{'type':'touchCancel','touchPoints':[]}); pg.wait_for_timeout(120)
            n2=pg.evaluate(q,css)
            pressed.append((sel,n0,n1,n2))
        def alpha(c):
            import re; m=re.findall(r'[\d.]+',c); return float(m[3]) if len(m)>3 else 1.0
        def lumc(c):
            import re; m=[float(x) for x in re.findall(r'[\d.]+',c)[:3]]; return 0.2126*m[0]+0.7152*m[1]+0.0722*m[2]
        ok(f'{theme} {w}px pressed state visible & reverts (buttons never vanish)', all(x[2][1]!='0' and x[2][2]=='visible' and x[3]==x[1] for x in pressed), pressed)
        ok(f'{theme} {w}px pressed bg never near-white in dark', theme=='light' or all(not(alpha(x[2][0])>=.5 and lumc(x[2][0])>=245) for x in pressed), pressed)
        ok(f'{theme} {w}px no console errors', not e2, e2)
        ctx.close()

    # ============ SW offline smoke ============
    ctx=new_ctx(sw='allow'); pg=ctx.new_page(); e3=[]; watch(pg,e3)
    goto(pg)
    pg.wait_for_function("navigator.serviceWorker && navigator.serviceWorker.controller!==null || (navigator.serviceWorker.ready && true)",timeout=15000)
    pg.reload(); pg.wait_for_function("window.PujaApp && PujaApp.counts().pandals>0",timeout=15000); pg.wait_for_timeout(1500)
    ctl=pg.evaluate("!!navigator.serviceWorker.controller")
    ok('SW controls page after reload', ctl)
    ctx.set_offline(True)
    pg.reload(); 
    try:
        pg.wait_for_function("window.PujaApp && PujaApp.counts().pandals>0",timeout=15000); off_ok=True
    except Exception as ex: off_ok=False
    ok('offline reload: shell + cached data load', off_ok)
    if off_ok:
        pg.wait_for_timeout(500)
        ok('offline: freshness says may be outdated', 'outdated' in pg.inner_text('#home-fresh').lower() or 'outdated' in pg.inner_text('#status-banners').lower(), pg.inner_text('#home-fresh'))
    ctx.set_offline(False)
    ctx.close()

    # ============ invalid data -> unavailable banner ============
    ctx=new_ctx(); pg=ctx.new_page(); e4=[]; watch(pg,e4)
    pg.route('**/data/puja-data.json*',lambda r: r.fulfill(status=200,content_type='application/json',body='{bad json'))
    pg.goto(BASE+'index.html'); pg.wait_for_timeout(1200)
    ok('invalid data -> Data unavailable banner', 'Data unavailable' in pg.inner_text('#status-banners'))
    ok('SOS still available when data fails', pg.is_visible('#sos-fab'))
    pg.click('#sos-fab'); pg.wait_for_timeout(200)
    ok('SOS 112 works without data', pg.get_attribute('#sos-list a[href^="tel:"]','href')=='tel:112')
    ctx.close()

    # ============ TAP-FLASH regression (white flash on mobile taps) ============
    SAMPLER = """()=>{window.__fs=[];window.__fsOn=true;
      const sels=['html','body','#mast','#theme-btn','#sos-fab','#sos-sheet','#sos-sheet .sheet-inner','#sos-sheet .sheet-close','#tabbar'];
      const tick=()=>{ if(!window.__fsOn) return; const f={t:performance.now()|0,theme:document.documentElement.dataset.theme};
        sels.forEach(s=>{const e=document.querySelector(s); if(!e) return; const c=getComputedStyle(e); f[s]=[c.backgroundColor,c.webkitTapHighlightColor,(e.tagName==='DIALOG'&&e.open)||e.tagName!=='DIALOG'];});
        const d=document.querySelector('#sos-sheet'); if(d&&d.open){f.backdrop=getComputedStyle(d,'::backdrop').backgroundColor;}
        window.__fs.push(f); requestAnimationFrame(tick);}; requestAnimationFrame(tick);}"""
    def rgba(s):
        import re
        m=re.findall(r'[\d.]+',s or ''); 
        if len(m)<3: return None
        r,g,b=[float(x) for x in m[:3]]; a=float(m[3]) if len(m)>3 else 1.0
        return r,g,b,a
    def near_white(s):
        v=rgba(s)
        if not v: return False
        r,g,b,a=v; return a>=0.5 and (0.2126*r+0.7152*g+0.0722*b)>=245
    def start(pg): pg.evaluate(SAMPLER)
    def stop(pg):
        pg.wait_for_timeout(120); fr=pg.evaluate("()=>{window.__fsOn=false;return window.__fs}"); return fr
    DARK_KEYS=['html','body','#mast','#theme-btn','#sos-fab','#tabbar','#sos-sheet .sheet-inner','#sos-sheet .sheet-close']
    def white_frames(frames,keys,mode='dark'):
        bad=[]
        for f in frames:
            if mode and f.get('theme')!=mode: continue
            for k in keys:
                v=f.get(k)
                if v and v[2] and near_white(v[0]): bad.append((f['t'],k,v[0]))
            if 'backdrop' in f and near_white(f['backdrop']): bad.append((f['t'],'::backdrop',f['backdrop']))
        return bad
    def tap_hl_bad(frames):
        return sorted({k for f in frames for k,v in f.items() if isinstance(v,list) and rgba(v[1]) and rgba(v[1])[3]>0})
    flash_log={}
    for (w,h) in [(390,844),(360,740)]:
        ctx=new_ctx(w,h); pg=ctx.new_page(); ef=[]; watch(pg,ef); cdp=ctx.new_cdp_session(pg)
        goto(pg)
        pg.evaluate("()=>{localStorage.setItem('spn.theme','light')}"); goto(pg)
        # all interactive elements: tap highlight transparent + appearance none on buttons
        hl=pg.evaluate("""()=>[...document.querySelectorAll('a,button,input,[role=tab],summary,label')].map(e=>[e.id||e.className||e.tagName,getComputedStyle(e).webkitTapHighlightColor,e.tagName==='BUTTON'?getComputedStyle(e).appearance:'none']).filter(x=>!/rgba\\(0, 0, 0, 0\\)|transparent/.test(x[1])||x[2]!=='none')""")
        ok(f'flash {w}: every interactive element has transparent tap highlight + appearance:none', not hl, hl[:8])
        def hold_stats(sel):
            bb=pg.locator(sel).bounding_box(); x=bb['x']+bb['width']/2; y=bb['y']+bb['height']/2
            clip={k:bb[k] for k in ('x','y','width','height')}
            b0=pngpx.stats(pg.screenshot(clip=clip))
            cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y}]}); pg.wait_for_timeout(60)
            b1=pngpx.stats(pg.screenshot(clip=clip,path=SHOTS+f'flash-{w}-{sel.strip("#")}-pressed.png'))
            pg.wait_for_timeout(60); b2=pngpx.stats(pg.screenshot(clip=clip))
            cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]}); pg.wait_for_timeout(250)
            return b0,b1,b2
        # light -> dark (tap)
        start(pg); pg.tap('#theme-btn'); fr=stop(pg)
        ok(f'flash {w}: light→dark switched', pg.evaluate("document.documentElement.dataset.theme")=='dark')
        ok(f'flash {w}: light→dark no near-white frame in dark', not white_frames(fr,DARK_KEYS), white_frames(fr,DARK_KEYS)[:5])
        ok(f'flash {w}: theme-btn never near-white during light→dark', not [f for f in fr if near_white(f['#theme-btn'][0])])
        ok(f'flash {w}: no tap highlight colour during tap', not tap_hl_bad(fr), tap_hl_bad(fr))
        # pressed-state pixels in dark mode: header button + FAB do not brighten while finger is down
        for sel in ('#theme-btn','#sos-fab'):
            b0,b1,b2=hold_stats(sel) if sel!='#theme-btn' else (None,None,None)
            if sel=='#theme-btn':
                # holding theme-btn then releasing would toggle; sample press without release via touchCancel
                bb=pg.locator(sel).bounding_box(); clip={k:bb[k] for k in ('x','y','width','height')}
                b0=pngpx.stats(pg.screenshot(clip=clip))
                cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':bb['x']+bb['width']/2,'y':bb['y']+bb['height']/2}]}); pg.wait_for_timeout(60)
                b1=pngpx.stats(pg.screenshot(clip=clip,path=SHOTS+f'flash-{w}-theme-btn-pressed.png')); b2=pngpx.stats(pg.screenshot(clip=clip))
                cdp.send('Input.dispatchTouchEvent',{'type':'touchCancel','touchPoints':[]}); pg.wait_for_timeout(200)
            flash_log[f'{w}-{sel}-dark-press']=(b0,b1,b2)
            ok(f'flash {w}: {sel} pressed (dark) does not brighten', b1['meanLum']-b0['meanLum']<6 and b2['meanLum']-b0['meanLum']<6 and b1['nearWhitePct']<=b0['nearWhitePct']+1, (b0,b1,b2))
        if pg.is_visible('#sos-sheet'): pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
        # open Help (SOS) in dark
        start(pg); pg.tap('#sos-fab'); pg.wait_for_timeout(250); fr=stop(pg)
        ok(f'flash {w}: SOS open (dark) sheet visible', pg.is_visible('#sos-sheet'))
        ok(f'flash {w}: SOS open (dark) no near-white frame incl dialog/backdrop', not white_frames(fr,DARK_KEYS), white_frames(fr,DARK_KEYS)[:5])
        ok(f'flash {w}: dialog element itself transparent, inner uses theme card', all((not f.get('#sos-sheet') or not f['#sos-sheet'][2] or rgba(f['#sos-sheet'][0])[3]==0) for f in fr))
        pg.screenshot(path=SHOTS+f'flash-{w}-sos-dark.png')
        # close with ×
        start(pg); pg.tap('#sos-sheet .sheet-close'); fr=stop(pg)
        ok(f'flash {w}: close × hides sheet', not pg.is_visible('#sos-sheet'))
        ok(f'flash {w}: close × no near-white frame', not white_frames(fr,DARK_KEYS), white_frames(fr,DARK_KEYS)[:5])
        # backdrop tap closes
        pg.tap('#sos-fab'); pg.wait_for_timeout(250)
        start(pg); pg.touchscreen.tap(w//2, 40); fr=stop(pg)
        ok(f'flash {w}: backdrop tap closes sheet', not pg.is_visible('#sos-sheet'))
        ok(f'flash {w}: backdrop tap no near-white frame', not white_frames(fr,DARK_KEYS), white_frames(fr,DARK_KEYS)[:5])
        ok(f'flash {w}: SOS aria-expanded reset after close', pg.get_attribute('#sos-fab','aria-expanded')=='false')
        # repeated taps x9 (3-way cycle Auto/Light/Dark from Dark: 9 taps -> ends dark; SOS opens/closes)
        start(pg)
        for i in range(9): pg.tap('#theme-btn'); pg.wait_for_timeout(40)
        fr=stop(pg)
        ok(f'flash {w}: 9x theme taps end in dark (3-way cycle)', pg.evaluate("document.documentElement.dataset.theme")=='dark')
        ok(f'flash {w}: 9x theme taps no near-white frame on dark frames', not white_frames(fr,['html','body','#mast','#theme-btn','#sos-fab','#tabbar']), white_frames(fr,['html','body','#mast','#theme-btn','#sos-fab','#tabbar'])[:5])
        ok(f'flash {w}: theme-btn never near-white in any frame (light or dark)', not [f for f in fr if near_white(f['#theme-btn'][0])])
        ok(f'flash {w}: theme-switching class cleaned up', not pg.evaluate("document.documentElement.classList.contains('theme-switching')"))
        start(pg)
        for i in range(10):
            pg.tap('#sos-fab'); pg.wait_for_timeout(60)
            if pg.is_visible('#sos-sheet'): pg.tap('#sos-sheet .sheet-close'); pg.wait_for_timeout(40)
        fr=stop(pg)
        ok(f'flash {w}: 10x SOS open/close no near-white frame', not white_frames(fr,DARK_KEYS), white_frames(fr,DARK_KEYS)[:5])
        # navigate + back in dark
        start(pg); pg.tap('#tabbar a[data-tab="pandals"]'); pg.wait_for_timeout(300)
        pg.tap('#nhood-list a >> nth=0'); pg.wait_for_timeout(300); pg.go_back(); pg.wait_for_timeout(300); pg.go_back(); pg.wait_for_timeout(300); fr=stop(pg)
        ok(f'flash {w}: navigate + back no near-white frame (dark)', not white_frames(fr,['html','body','#mast','#theme-btn','#sos-fab','#tabbar']), white_frames(fr,['html','body','#mast','#tabbar'])[:5])
        # subtab + back link taps in dark
        go(pg,'parking'); start(pg); pg.tap('#sub-traffic'); pg.wait_for_timeout(150); pg.tap('#sub-parking'); pg.wait_for_timeout(150); fr=stop(pg)
        sub=pg.evaluate("()=>[...document.querySelectorAll('.subtab')].map(e=>getComputedStyle(e).backgroundColor)")
        ok(f'flash {w}: subtabs dark bg not near-white', not any(near_white(x) for x in sub), sub)
        # reload in dark: first frames already dark (theme-init.js)
        pg.add_init_script("window.__early=[];const t=()=>{if(document.body){window.__early.push([document.documentElement.getAttribute('data-theme'),getComputedStyle(document.documentElement).backgroundColor,getComputedStyle(document.body).backgroundColor])} if(window.__early.length<6)requestAnimationFrame(t)};requestAnimationFrame(t);")
        pg.reload(); pg.wait_for_selector('#tabbar:not([hidden])'); pg.wait_for_timeout(300)
        early=pg.evaluate("window.__early")
        flash_log[f'{w}-reload-dark-early']=early
        ok(f'flash {w}: reload in dark — first painted frames dark (no cream/white)', early and all(e[0]=='dark' and not near_white(e[1]) and not near_white(e[2]) for e in early), early)
        # dark -> light (tap): light theme button colours stay design colours (theme-btn/sos never white)
        start(pg); pg.tap('#theme-btn'); fr=stop(pg)
        ok(f'flash {w}: dark→light switched', pg.evaluate("document.documentElement.dataset.theme")=='light')
        ok(f'flash {w}: dark→light theme-btn/FAB/mast never near-white', not white_frames(fr,['#theme-btn','#sos-fab','#mast'],mode=None), white_frames(fr,['#theme-btn','#sos-fab','#mast'],mode=None)[:5])
        pg.tap('#sos-fab'); pg.wait_for_timeout(250)
        cl=pg.evaluate("()=>getComputedStyle(document.querySelector('#sos-sheet .sheet-close')).backgroundColor")
        ok(f'flash {w}: light close × uses theme surface (not pure white)', cl!='rgb(255, 255, 255)', cl)
        pg.keyboard.press('Escape'); pg.wait_for_timeout(150)
        ok(f'flash {w}: no console errors', not ef, ef)
        ctx.close()
    # ============ theme: Auto (follow phone) -> Light -> Dark -> Auto ============
    for scheme in ('light','dark'):
        ctx=b.new_context(viewport={'width':412,'height':915},is_mobile=True,has_touch=True,device_scale_factor=2,service_workers='block',color_scheme=scheme)
        ctx.route('https://tile.openstreetmap.org/**',lambda r: r.fulfill(status=200,content_type='image/png',body=PNG))
        pg=ctx.new_page(); et=[]; watch(pg,et); goto(pg)
        st=lambda: pg.evaluate("()=>[document.documentElement.dataset.themeMode,document.documentElement.dataset.theme,document.querySelector('meta[name=theme-color]').content,localStorage.getItem('spn.theme'),document.querySelector('#theme-btn').getAttribute('aria-label'),document.querySelector('#theme-btn .theme-lbl').textContent]")
        s0=st(); col='#24060c' if scheme=='dark' else '#5a0f1e'
        ok(f'theme auto default follows phone ({scheme})', s0[0]=='auto' and s0[1]==scheme and s0[2]==col and s0[3] is None and s0[5]=='Auto' and 'Auto' in s0[4], s0)
        if scheme=='light': pg.screenshot(path=SHOTS+'theme-412-auto-light.png')
        else: pg.screenshot(path=SHOTS+'theme-412-auto-dark.png')
        other='light' if scheme=='dark' else 'dark'
        pg.emulate_media(color_scheme=other); pg.wait_for_timeout(200)
        s1=st(); ok(f'theme auto live-updates when OS changes ({scheme}->{other})', s1[0]=='auto' and s1[1]==other, s1)
        pg.emulate_media(color_scheme=scheme); pg.wait_for_timeout(200)
        pg.tap('#theme-btn'); pg.wait_for_timeout(150); s2=st()
        ok(f'theme tap 1 -> Light override ({scheme})', s2[0]=='light' and s2[1]=='light' and s2[2]=='#5a0f1e' and s2[3]=='light' and s2[5]=='Light', s2)
        if scheme=='light': pg.screenshot(path=SHOTS+'theme-412-light.png')
        pg.emulate_media(color_scheme='dark'); pg.wait_for_timeout(200)
        ok(f'theme override ignores OS change ({scheme})', st()[1]=='light')
        pg.emulate_media(color_scheme=scheme)
        pg.tap('#theme-btn'); pg.wait_for_timeout(150); s3=st()
        ok(f'theme tap 2 -> Dark override ({scheme})', s3[0]=='dark' and s3[1]=='dark' and s3[2]=='#24060c' and s3[3]=='dark' and s3[5]=='Dark', s3)
        if scheme=='light': pg.screenshot(path=SHOTS+'theme-412-dark.png')
        ok(f'theme Home fits one viewport at 412 ({scheme})', pg.evaluate("document.documentElement.scrollHeight<=innerHeight+1"))
        pg.reload(); pg.wait_for_selector('#tabbar:not([hidden])'); ok(f'theme override persists across reload ({scheme})', st()[:2]==['dark','dark'])
        pg.tap('#theme-btn'); pg.wait_for_timeout(150); s4=st()
        ok(f'theme tap 3 -> back to Auto, storage cleared ({scheme})', s4[0]=='auto' and s4[1]==scheme and s4[3] is None, s4)
        ok(f'theme no console errors ({scheme})', not et, et)
        ctx.close()
    # pre-paint: auto + dark phone paints dark on first frame
    ctx=b.new_context(viewport={'width':360,'height':780},is_mobile=True,service_workers='block',color_scheme='dark'); pg=ctx.new_page()
    pg.add_init_script("window.__e=[];const t=()=>{if(document.body)window.__e.push(document.documentElement.getAttribute('data-theme'));if(window.__e.length<4)requestAnimationFrame(t)};requestAnimationFrame(t);")
    goto(pg); e=pg.evaluate('window.__e'); ok('theme auto dark: first painted frames dark', e and all(x=='dark' for x in e), e); ctx.close()
    for (w,h) in [(360,780),(430,932)]:
        for m in ('auto','light','dark'):
            ctx=new_ctx(w,h)
            if m!='auto': ctx.add_init_script(f"localStorage.setItem('spn.theme','{m}')")
            pg=ctx.new_page(); goto(pg)
            ok(f'theme {m} {w}px Home no vertical scroll', pg.evaluate("document.documentElement.scrollHeight<=innerHeight+1"))
            bb=pg.locator('#theme-btn').bounding_box(); ok(f'theme {m} {w}px toggle ≥44px & on screen', bb['width']>=44 and bb['height']>=44 and bb['x']+bb['width']<=w, bb)
            ctx.close()
    # ============ install card: Home fits one viewport, card visible ============
    for theme in ('light','dark'):
        for (w,h) in [(360,780),(390,844),(412,915),(430,932)]:
            ctx=new_ctx(w,h); ctx.add_init_script(f"localStorage.setItem('spn.theme','{theme}')"); pg=ctx.new_page(); e3=[]; watch(pg,e3)
            goto(pg)
            pg.evaluate("PujaApp._setDeferredInstall({prompt:function(){return Promise.resolve({})}})"); pg.wait_for_timeout(250)
            ok(f'install card {theme} {w}px visible', pg.is_visible('#install-card'))
            ok(f'install card {theme} {w}px Home no vertical scroll', pg.evaluate("document.documentElement.scrollHeight<=innerHeight+1"), pg.evaluate("[document.documentElement.scrollHeight,innerHeight]"))
            ok(f'install card {theme} {w}px no horizontal scroll', not pg.evaluate("document.documentElement.scrollWidth>innerWidth"))
            cb=pg.locator('#install-card').bounding_box(); fab=pg.locator('#sos-fab').bounding_box(); bar=pg.locator('#tabbar').bounding_box(); cta=pg.locator('#view-home .bigrow').bounding_box(); warn=pg.locator('#view-home .warn-card').bounding_box()
            ok(f'install card {theme} {w}px clear of SOS, tabbar, actions, warning', not rects_overlap(cb,fab) and not rects_overlap(cb,bar) and not rects_overlap(cb,cta) and not rects_overlap(cb,warn) and not rects_overlap(cb,pg.locator('#install-btn').bounding_box()) and cb['x']>=0 and cb['x']+cb['width']<=w, [cb,fab,warn])
            small=pg.evaluate("[...document.querySelectorAll('#install-card button')].map(e=>e.getBoundingClientRect()).filter(r=>r.height<44||r.width<44).length")
            ok(f'install card {theme} {w}px buttons ≥44px', small==0)
            if w in (360,412): pg.screenshot(path=SHOTS+f'install-card-{w}-{theme}.png')
            ok(f'install card {theme} {w}px no console errors', not e3, e3)
            ctx.close()
    json.dump(flash_log,open(SHOTS+'flash-samples.json','w'),indent=1)
    b.close()

passed=sum(1 for _,c in results if c); failed=len(results)-passed
print(f'{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)

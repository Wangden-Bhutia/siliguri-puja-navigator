"""Playwright e2e for Siliguri Puja Guide — 3-tab UX (schema v2).
Usage: python tests/e2e.py [BASE_URL]   (default http://127.0.0.1:8777/siliguri-puja-navigator/)
Env: SHOTS=<dir>. Uses system Chrome. No invented approved traffic; DEMO records only."""
import base64, json, os, sys
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
    ok('home single warn card', pg.locator('#view-home .warn-card').count()==1)
    ok('demo/pending banner shown', 'pending 2026 field verification' in pg.inner_text('#status-banners').lower())
    ok('identity strip with 2 logos', pg.is_visible('#idstrip') and pg.locator('#idstrip-logos img').count()==2)
    ok('footer says Demo version', 'Demo version' in pg.inner_text('#foot-line'))
    pg.screenshot(path=SHOTS+'home-390.png',full_page=False)

    # J1 Home -> Find Pandal
    pg.click('#view-home a.bigbtn-primary'); pg.wait_for_timeout(400)
    ok('J1 Home→Find Pandal: pandals view', visible_view(pg)=='pandals')
    n_items=pg.locator('#nhood-list li').count()
    ok('Pandals default = neighbourhood list (28)', n_items==28 and pg.is_hidden('#pandal-search-list'), n_items)
    first=pg.inner_text('#nhood-list li:first-child')
    ok('neighbourhood item shows count', 'pandal' in first, first)
    pg.screenshot(path=SHOTS+'pandals-390.png')

    # search switches to flat list
    pg.fill('#q','Dada'); pg.wait_for_timeout(250)
    ok('search shows flat results', pg.is_visible('#pandal-search-list') and pg.is_hidden('#nhood-list') and pg.locator('#pandal-search-list .pandal-card').count()>=1)
    card=pg.inner_text('#pandal-search-list .pandal-card >> nth=0')
    ok('card minimal: name+locality+status, no coords/source', 'Dada Bhai' in card and 'Deshbandhupara' in card and 'Pending 2026 verification' in card and 'Pujo Songi' not in card and '26.7' not in card, card)
    ok('no "verified" claim on card', 'Verified' not in card.replace('verification',''), card)
    pg.fill('#q',''); pg.wait_for_timeout(200)
    ok('clearing search restores neighbourhoods', pg.is_visible('#nhood-list'))

    # J2 Home -> Parking & Walking
    go(pg,'')
    pg.click('#view-home a[data-go="parking"]'); pg.wait_for_timeout(500)
    ok('J2 Home→Parking: parking panel', visible_view(pg)=='parking' and pg.is_visible('#panel-parking') and pg.is_hidden('#panel-traffic'))
    pk=pg.inner_text('#parking-list')
    ok('parking cards clearly DEMO', pk.count('DEMO')>=2 and 'Sample scenario' in pk, pk[:200])
    ok('parking shows served pandals + walk', 'Serves:' in pk and 'Walking distance' in pk and 'Walking time' in pk)
    ok('parking tab current', pg.get_attribute('#tabbar a[data-tab="parking"]','aria-current')=='page')

    # J3 Home -> Traffic
    go(pg,'')
    pg.click('#view-home a[data-go="traffic"]'); pg.wait_for_timeout(500)
    ok('J3 Home→Traffic: traffic panel', visible_view(pg)=='parking' and pg.is_visible('#panel-traffic') and pg.get_attribute('#sub-traffic','aria-selected')=='true')
    tx=pg.inner_text('#panel-traffic')
    ok('2025 baseline never shown', '2025' not in tx and 'Airview' not in tx and 'Naukaghat' not in tx, tx[:300])

    # J8 Traffic -> Active restriction (set a DEMO window time)
    pg.fill('#t-date','2026-10-17'); pg.dispatch_event('#t-date','change')
    pg.fill('#t-time','19:30'); pg.dispatch_event('#t-time','change'); pg.wait_for_timeout(250)
    act=pg.inner_text('#traffic-active')
    ok('J8 active DEMO Sevoke More card', 'Sevoke More' in act and 'Vehicle restriction' in act and 'DEMO' in act and 'Sample scenario' in act, act)
    ok('traffic card hides authority/order/source', 'source' not in act.lower() and 'order no' not in act.lower() and 'authority' not in act.lower())
    ok('active card shows time range', 'PM' in act and 'AM' in act, act)
    pg.click('#traffic-active button:has-text("View map")'); pg.wait_for_timeout(500)
    ok('View map reveals traffic map', pg.is_visible('#map-traffic') and pg.locator('#map-traffic .mk-traf').count()==1)
    pg.fill('#t-date','2026-10-25'); pg.dispatch_event('#t-date','change'); pg.wait_for_timeout(200)
    ok('after festival: no active, no upcoming (expired hidden)', pg.locator('#traffic-active li').count()==0 and pg.locator('#traffic-upcoming li').count()==0 and pg.is_visible('#traffic-active-empty'))

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
    ok('pandal detail: pending verification note', 'Location pending 2026 field verification' in det)
    ok('pandal detail sections Where/Get there/Traffic/help', all(s in det for s in ['Where is it?','Get there','Traffic','Nearby help']))
    ok('pandal detail no source/coords', 'Pujo Songi' not in det and '26.71' not in det)
    ok('pandal map has marker', pg.locator('#map-pandal .mk-pandal').count()==1)
    # J6 Pandal -> Parking
    pkd=pg.inner_text('#pandal-parking')
    ok('J6 Pandal→Parking: DEMO drop + walk info', 'DEMO' in pkd and 'Walking distance' in pkd and 'Walking time' in pkd, pkd[:300])
    ok('pandal traffic empty-state copy', 'No published restriction for this area' in pg.inner_text('#pandal-traffic'))
    ok('pandal nearby PAB is DEMO', 'DEMO' in pg.inner_text('#pandal-help'))
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

    # J7 Parking -> walking route
    go(pg,'parking')
    ok('J7 parking walking route list', pg.locator('#parking-list li ul li').count()>=1)
    ok('parking map markers', pg.locator('#map-parking .mk-park').count()==2)

    # history back
    go(pg,'pandals'); go(pg,'n/hakimpara')
    pg.go_back(); pg.wait_for_timeout(400)
    ok('history back works', visible_view(pg)=='pandals')

    # J9 SOS -> 112
    pg.click('#sos-fab'); pg.wait_for_timeout(300)
    ok('J9 SOS sheet opens', pg.is_visible('#sos-sheet'))
    sos=pg.inner_text('#sos-sheet')
    ok('SOS 112 call link', pg.get_attribute('#sos-list a[href^="tel:"]','href')=='tel:112')
    ok('SOS control rooms: number to be confirmed, no Call', sos.count('Number to be confirmed for 2026')==2 and pg.locator('#sos-list a[href^="tel:"]').count()==1, sos)
    ib=pg.locator('#sos-sheet .sheet-inner').bounding_box()
    ok('SOS is a bottom sheet (anchored to bottom)', ib and abs((ib['y']+ib['height'])-844)<=2, ib)
    ok('SOS fab aria-expanded', pg.get_attribute('#sos-fab','aria-expanded')=='true')
    pg.screenshot(path=SHOTS+'sos-390.png')
    # J10 SOS -> PAB
    pg.click('#sos-list a[href="#/facilities/pab"]'); pg.wait_for_timeout(500)
    ok('J10 SOS→PAB facilities view', visible_view(pg)=='facilities' and 'Police Assistance Booths' in pg.inner_text('#fac-title') and not pg.is_visible('#sos-sheet'))
    ok('PAB DEMO card + marker', 'DEMO' in pg.inner_text('#fac-list') and pg.locator('#map-facilities .mk-fac').count()==1)
    # J11 SOS -> Hospital
    pg.click('#sos-fab'); pg.wait_for_timeout(300)
    pg.click('#sos-list a[href="#/facilities/hospital"]'); pg.wait_for_timeout(500)
    ok('J11 SOS→Hospital', 'Hospitals' in pg.inner_text('#fac-title') and 'DEMO' in pg.inner_text('#fac-list'))

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
    for w,h in [(360,780),(390,844),(412,915)]:
        ctx=new_ctx(w,h); pg=ctx.new_page(); e2=[]; watch(pg,e2)
        for route in ['','pandals','n/siliguri-town','p/SG26-001','parking','parking/traffic','facilities/pab']:
            goto(pg,route) if route=='' else go(pg,route,550)
            hs=pg.evaluate("document.documentElement.scrollWidth>innerWidth")
            ok(f'{w}px #{route or "/"} no horizontal scroll', not hs)
            fab=pg.locator('#sos-fab').bounding_box(); bar=pg.locator('#tabbar').bounding_box()
            ok(f'{w}px #{route or "/"} SOS above tabbar (no overlap)', fab and bar and not rects_overlap(fab,bar) and fab['y']+fab['height']<=bar['y'], [fab,bar])
            # scroll to bottom: last actionable control should not be hidden under fab/tabbar
            pg.evaluate("window.scrollTo(0,document.body.scrollHeight)"); pg.wait_for_timeout(150)
            covered=pg.evaluate("""()=>{const fab=document.querySelector('#sos-fab').getBoundingClientRect();const bar=document.querySelector('#tabbar').getBoundingClientRect();
              const els=[...document.querySelectorAll('.view:not([hidden]) a, .view:not([hidden]) button, .footlinks a')].filter(e=>e.offsetParent);
              const last=els[els.length-1]; if(!last) return null; const r=last.getBoundingClientRect();
              const ov=(a,b)=>!(a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top);
              return ov(r,fab)||ov(r,bar)?{t:last.textContent.trim().slice(0,40),r:[r.top,r.bottom,r.left,r.right]}:null}""")
            ok(f'{w}px #{route or "/"} last control reachable (not under SOS/tabbar)', covered is None, covered)
            if route in ('p/SG26-001',):
                zc=pg.locator('#map-pandal .leaflet-control-zoom').bounding_box()
                pg.evaluate("document.querySelector('#map-pandal').scrollIntoView({block:'center'})"); pg.wait_for_timeout(100)
                zc=pg.locator('#map-pandal .leaflet-control-zoom').bounding_box(); fab=pg.locator('#sos-fab').bounding_box()
                ok(f'{w}px map zoom controls not under SOS', not rects_overlap(zc,fab), [zc,fab])
        # touch targets
        go(pg,'')
        small=pg.evaluate("""[...document.querySelectorAll('#tabbar a, #sos-fab, .bigbtn, #theme-btn')].filter(e=>e.offsetParent||e.id==='sos-fab').map(e=>{const r=e.getBoundingClientRect();return [e.id||e.className,r.width,r.height]}).filter(x=>x[1]<44||x[2]<44)""")
        ok(f'{w}px touch targets ≥44px', not small, small)
        ok(f'{w}px no console errors', not e2, e2)
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
    b.close()

passed=sum(1 for _,c in results if c); failed=len(results)-passed
print(f'{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)

"""Playwright e2e for Siliguri Puja Guide (visitor flow).
Usage: python tests/e2e.py [BASE_URL]   (default http://127.0.0.1:8777/siliguri-puja-navigator/)
Env: SHOTS=<dir> (default /workspace/siliguri-puja-navigator-shots-v2/), AXE=<axe.min.js> (default /tmp/axe.min.js, optional).
Needs: playwright + system Chrome.  All fixtures are synthetic and labelled TEST FIXTURE; nothing here is real Puja data."""
import base64, json, os, sys, copy, re, urllib.request
from playwright.sync_api import sync_playwright

args=[a for a in sys.argv[1:] if not a.startswith('--')]
BASE=(args[0] if args else 'http://127.0.0.1:8777/siliguri-puja-navigator/').rstrip('/')+'/'
ORIGIN=BASE.split('/',3)[0]+'//'+BASE.split('/',3)[2]
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS=os.environ.get('SHOTS','/workspace/siliguri-puja-navigator-shots-v2/').rstrip('/')+'/'
os.makedirs(SHOTS,exist_ok=True)
AXEP=os.environ.get('AXE','/tmp/axe.min.js')
AXE=open(AXEP).read() if os.path.exists(AXEP) else None
PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')
DEMO=json.load(open(os.path.join(ROOT,'data','puja-data.json')))
DISCLAIMER='Google Maps may not reflect temporary Puja traffic restrictions, diversions or pedestrian arrangements. Follow on-ground traffic police directions and posted signs. Use only designated parking and drop-off points.'
results=[]
def ok(name,cond,info=''):
    results.append((name,bool(cond)))
    print(('PASS ' if cond else 'FAIL ')+name+((' | '+str(info)[:300]) if (info!='' and not cond) else ''))

XSS_IMG='<img src=x onerror="window.__xss=1">Evil'
def verified_fixture():
    base=lambda i,**k: dict(dict(id=i,status='admin-verified',source='TEST FIXTURE notice',verifiedAt='2026-10-04T12:00:00+05:30',verifiedBy='Test office'),**k)
    d={'meta':{'datasetVersion':'fixture-1','lastUpdated':'2026-10-04T12:00:00+05:30','isDemoDataset':False,'festival':{'name':'Fixture Fest','startDate':'2026-10-17','endDate':'2026-10-21'}},
     'pandals':[
       base('p-ok',name='Fixture Pandal OK',locality='Fixture Loc',landmark='Fixture landmark',address='1 Fixture Rd',lat=26.7271,lon=88.3953,status='official',restrictionIds=['r-active'],
            entrances=[base('p-ok-e1',name='Fixture main gate',lat=26.7275,lon=88.3958,verified=True,description='Gate on the north side'),
                       {'id':'p-ok-e2','name':'Fixture unverified gate','lat':26.7262,'lon':88.3949,'verified':False}]),
       base('p-xss',name=XSS_IMG,locality='"><script>window.__xss=2</script>',address="' onmouseover='window.__xss=4",description='<svg onload=window.__xss=3>',lat=26.73,lon=88.40,sourceUrl='javascript:window.__xss=5',timings='<b>bold</b>',imageUrl='javascript:window.__xss=6'),
       base('p-badcoord',name='Bad coords pandal',locality='X',lat=12.0,lon=88.4),
       base('p-noprov',name='No provenance pandal',locality='X',lat=26.72,lon=88.39,source=''),
       dict(id='p-unv',name='Fixture unverified pandal',locality='Fixture Loc',status='unconfirmed',lat=26.7222,lon=88.3922,entrances=[{'id':'p-unv-e1','name':'Claimed gate','lat':26.7225,'lon':88.3925,'verified':True,'source':'x','verifiedAt':'2026-10-04T12:00:00+05:30','verifiedBy':'x'}]),
     ],
     'parking':[base('k-ok',name='Fixture Parking',locality='Fixture Loc',lat=26.725,lon=88.392,approved=True,status='official')],
     'accessPoints':[base('a-drop',name='Fixture drop-off',type='drop-off',lat=26.7255,lon=88.3935,designated=True,status='official'),
                     base('a-pick',name='Fixture pick-up (not designated)',type='pick-up',lat=26.7258,lon=88.3938)],
     'walkingRoutes':[
        base('w-ok',name='Fixture verified walk',fromId='k-ok',pandalId='p-ok',entranceId='p-ok-e1',routeVerified=True,distanceM=1800,timeMin=25,status='official',
             waypoints=[{'lat':26.725,'lon':88.392,'label':'Start'},{'lat':26.7262,'lon':88.3940},{'lat':26.7275,'lon':88.3958,'label':'Gate'}],instructions=['Walk north along Fixture Rd.','The gate is on your left.']),
        base('w-unv',name='Fixture unverified walk',fromId='a-drop',pandalId='p-ok',routeVerified=False,distanceM=300,timeMin=4,
             waypoints=[{'lat':26.7255,'lon':88.3935},{'lat':26.7271,'lon':88.3953}],instructions=['Unverified step one.'])],
     'restrictions':[
       base('r-active',name='Fixture active notice',type='no-entry',locationText='Fixture Rd',roadStretch='Fixture Rd, A to B',direction='Both directions',vehicleTypes=['cars'],lat=26.7285,lon=88.397,start='2026-10-18T10:00:00+05:30',end='2026-10-18T20:00:00+05:30',status='official',pedestrianAccess='Pedestrians allowed on the north footpath'),
       base('r-night',name='Fixture night notice',type='vehicle-restriction',locationText='Night Rd',recurring={'dateStart':'2026-10-17','dateEnd':'2026-10-21','dailyStart':'22:00','dailyEnd':'05:00'},status='official'),
       base('r-future',name='Fixture future notice',type='diversion',locationText='Future Rd',start='2026-10-21T16:00:00+05:30',end='2026-10-22T02:00:00+05:30'),
       base('r-expired',name='Fixture expired notice',type='one-way',locationText='Old Rd',start='2026-10-12T00:00:00+05:30',end='2026-10-13T00:00:00+05:30'),
       base('r-cancel',name='Fixture cancelled notice',type='no-entry',locationText='Cancel Rd',cancelled=True,start='2026-10-18T10:00:00+05:30',end='2026-10-18T20:00:00+05:30'),
       dict(id='r-unconf',name='Fixture unconfirmed report',type='one-way',locationText='Rumour Rd',status='unconfirmed',start='2026-10-18T10:00:00+05:30',end='2026-10-18T20:00:00+05:30',pedestrianAccess='Pedestrians always allowed'),
       base('r-nosource',name='Missing source notice',type='no-entry',locationText='Z',start='2026-10-18T10:00:00+05:30',end='2026-10-18T20:00:00+05:30',source=''),
       base('r-xss',name=XSS_IMG+' restriction',type='no-entry',locationText='<script>window.__xss=7</script>',description='<img src=x onerror=window.__xss=8>',lat=26.735,lon=88.41,start='2026-10-25T10:00:00+05:30',end='2026-10-25T20:00:00+05:30'),
       base('r-geo',name='Fixture geometry notice',type='no-entry',locationText='Geo Rd',geometry={'type':'LineString','coordinates':[[88.39,26.72],[88.40,26.73]]},geometryVerified=True,lat=26.725,lon=88.395,start='2026-10-18T10:00:00+05:30',end='2026-10-18T20:00:00+05:30',status='official'),
     ],
     'diversionPoints':[base('d-1',name='Fixture diversion point',restrictionId='r-active',lat=26.7290,lon=88.3990,instruction='Fixture: turn left at the fixture junction.',order=1,landmark='Fixture junction'),
                        {'id':'d-bad','name':'Orphan diversion','restrictionId':'nope','lat':26.73,'lon':88.40,'instruction':'x','status':'official','source':'s','verifiedAt':'2026-10-04T12:00:00+05:30','verifiedBy':'t'}],
     'facilities':[base('f-hosp',name='Fixture Hospital',type='hospital',lat=26.7300,lon=88.3900,hours='24 hours',emergencyCapabilityVerified=True,emergencyCapable=True,phone='+91 353 000 0000',phoneAuthorised=True),
                   base('f-hosp2',name='Fixture Hospital No Phone',type='hospital',lat=26.7310,lon=88.3910,phone='+91 353 111 1111',phoneAuthorised=False),
                   base('f-wc',name='Fixture toilets',type='toilet',lat=26.7265,lon=88.3945,landmark='By the fixture gate')]}
    return d

with sync_playwright() as p:
    b=p.chromium.launch(channel='chrome',headless=True)
    def new_ctx(mobile=True,sw='block',**kw):
        o=dict(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,device_scale_factor=2) if mobile else dict(viewport={'width':1280,'height':800})
        o.update(kw)
        c=b.new_context(service_workers=sw,**o)
        c.route('https://tile.openstreetmap.org/**',lambda r: r.fulfill(status=200,content_type='image/png',body=PNG))
        return c
    def watch(pg,store):
        pg.on('console',lambda m: store.append(m.type+': '+m.text) if m.type in('error','warning') and 'blocked by Playwright' not in m.text else None)
        pg.on('pageerror',lambda e: store.append('PAGEERROR '+str(e)+' @ '+(getattr(e,'stack','') or '')[:1500].replace(chr(10),' | ')))
        pg.on('dialog',lambda d: (store.append('DIALOG '+d.message),d.dismiss()))
    def serve_json(pg,body,status=200,ctype='application/json',counter=None):
        def h(r):
            if counter is not None: counter.append(r.request.url)
            r.fulfill(status=status,content_type=ctype,body=body if isinstance(body,str) else json.dumps(body))
        pg.route('**/data/puja-data.json*',h)
    def goto(pg,route='',wait=900):
        pg.goto(BASE+'index.html'+('#/'+route if route else '')); pg.wait_for_selector('#main',state='attached'); pg.wait_for_timeout(wait)
    def go(pg,route,wait=500):
        pg.evaluate("r=>{location.hash='#/'+r}",route); pg.wait_for_timeout(wait)
    def hscroll(pg): return pg.evaluate("document.documentElement.scrollWidth>innerWidth || document.body.scrollWidth>innerWidth")
    def counts(pg): return pg.evaluate("PujaApp.counts()")
    def info(pg): return pg.evaluate("PujaApp.info()")
    def vis(pg,sel): return pg.is_visible(sel)
    def view_text(pg,v): return pg.inner_text('#view-'+v)
    def set_time(pg,v): pg.fill('#check-at',v); pg.dispatch_event('#check-at','change'); pg.wait_for_timeout(150)
    def states(pg,sel):
        return pg.evaluate("sel=>Object.fromEntries([...document.querySelectorAll(sel+' .card')].map(c=>[c.dataset.id,c.querySelector('.state .st-t').textContent.trim()]))",sel)
    def chip(pg,name,val): pg.click('label.chip:has(input[name="%s"][value="%s"])'%(name,val)); pg.wait_for_timeout(250)
    def set_visibility(pg,state):
        pg.evaluate("s=>{Object.defineProperty(document,'visibilityState',{get:()=>s,configurable:true});document.dispatchEvent(new Event('visibilitychange'))}",state)

    # ================= 1. demo dataset, mobile: HOME =================
    ctx=new_ctx(); pg=ctx.new_page(); errs=[]; reqs=[]; bad=[]
    watch(pg,errs); pg.on('request',lambda r: reqs.append(r.url)); pg.on('response',lambda r: bad.append((r.status,r.url)) if r.status>=400 else None)
    geo_calls=[]
    pg.add_init_script("window.__geo=0;const g=navigator.geolocation;if(g){const o=g.getCurrentPosition.bind(g);g.getCurrentPosition=function(){window.__geo++;return o.apply(g,arguments)};const w=g.watchPosition.bind(g);g.watchPosition=function(){window.__geo++;return w.apply(g,arguments)}}")
    goto(pg)
    ok('title / h1 / tagline / descriptor / dates (Siliguri Puja Guide)',pg.title()=='Siliguri Puja Guide' and ' '.join(pg.inner_text('h1').split())=='Siliguri Puja Guide' and pg.inner_text('#tagline')=='Find pandals. Plan your route. Travel safely.' and pg.locator('#descriptor').text_content()=='Official Durga Puja Traffic & Visitor Information' and pg.locator('#festival-dates').text_content()=='16 – 21 October 2026',pg.title())
    big=pg.locator('#view-home .bigactions a')
    ok('home: exactly three big actions with the required labels and descriptions',big.count()==3 and [[big.nth(k).locator('.bb-t').text_content(),big.nth(k).locator('.bb-s').text_content()] for k in range(3)]==[['Find a Pandal','Search by name or area and get directions.'],['Parking & Routes','Parking, drop-off and walking routes.'],['Traffic & Help','Traffic updates and essential services.']],[big.nth(k).inner_text() for k in range(big.count())])
    ok('home: big actions link to #/find #/parking #/traffic',[big.nth(i).get_attribute('href') for i in range(3)]==['#/find','#/parking','#/traffic'])
    ok('home: primary card is full width (>=300px) and >=76px tall; secondary cards >=44px tall',pg.evaluate("(()=>{const a=[...document.querySelectorAll('#view-home .bigactions a')].map(x=>x.getBoundingClientRect());return a[0].width>=300&&a[0].height>=76&&a[1].height>=44&&a[2].height>=44})()"))
    ok('home: NO map and no markers on home',pg.locator('#view-home .leaflet-container').count()==0 and pg.locator('#view-home .map-frame').count()==0 and pg.locator('.leaflet-container').count()==0 or not vis(pg,'.leaflet-container'),pg.locator('.leaflet-container').count())
    ok('home: compact freshness indicator with IST time',pg.locator('#view-home [data-fresh]').count()==1 and 'IST' in pg.inner_text('#view-home [data-fresh]') and pg.inner_text('#view-home [data-fresh]').startswith('Data updated'),pg.inner_text('#view-home [data-fresh]'))
    ok('home: short traffic/navigation warning visible',vis(pg,'#view-home .banner-permanent') and 'Follow the directions of traffic police' in pg.inner_text('#view-home .banner-permanent'))
    ok('home: no onboarding / account / sign-in / modal dialogs',pg.locator('dialog,[role=dialog],[aria-modal=true]').count()==0 and not any(w in pg.inner_text('body').lower() for w in ('sign in','log in','create account','welcome tour')))
    ok('home: demo banner (Demo data – locations and traffic orders are not verified. / Not real pandals or orders.)',vis(pg,'#bn-demo') and 'Demo data – locations and traffic orders are not verified.' in pg.inner_text('#bn-demo') and 'Not real pandals or orders.' in pg.inner_text('#bn-demo'))
    ok('home: tab bar hidden on home',not vis(pg,'#tabbar'))
    ok('home: geolocation NOT requested on load (and no permission prompt path)',pg.evaluate("window.__geo")==0)
    ok('home: no horizontal scroll',not hscroll(pg))
    ok('home: admin tooling is not linked from the public UI',pg.locator('a[href*="admin"]').count()==0 and 'admin-preview' not in pg.content())
    pg.screenshot(path=SHOTS+'01-home.png')

    # ================= 2. navigation / back button =================
    pg.click('#view-home .bigactions a[href="#/find"]'); pg.wait_for_timeout(500)
    ok('nav: Find a Pandal opens #/find, tab bar visible',pg.evaluate("location.hash")=='#/find' and vis(pg,'#view-find') and not vis(pg,'#view-home') and vis(pg,'#tabbar'))
    ok('nav: focus moves to the view heading (screen readers)',pg.evaluate("document.activeElement.tagName")=='H2',pg.evaluate("document.activeElement.outerHTML.slice(0,80)"))
    pg.go_back(); pg.wait_for_timeout(400)
    ok('nav: browser Back returns to home',pg.evaluate("location.hash")in('','#/') and vis(pg,'#view-home'))
    pg.go_forward(); pg.wait_for_timeout(300); ok('nav: Forward works',vis(pg,'#view-find'))
    for r,v in (('parking','parking'),('traffic','traffic'),('help','help'),('info','info')):
        pg.click('#tabbar a[data-tab="%s"]'%r); pg.wait_for_timeout(400)
        ok('nav: tab %s shows only its view, aria-current set'%r,vis(pg,'#view-'+v) and sum(vis(pg,'#view-'+x) for x in('home','find','parking','traffic','help','info'))==1 and pg.get_attribute('#tabbar a[data-tab="%s"]'%r,'aria-current')=='page')
    pg.click('#brand-link'); pg.wait_for_timeout(300); ok('nav: brand link returns home',vis(pg,'#view-home'))
    go(pg,'bogus/route'); ok('nav: unknown route falls back to home',vis(pg,'#view-home'))
    pg.evaluate("location.hash='#section'"); pg.wait_for_timeout(200); ok('nav: foreign hash does not break the view',vis(pg,'#view-home'))
    ok('nav: no nested menus or modals anywhere',pg.locator('nav nav,[role=menu],dialog,[aria-haspopup]').count()==0)
    ok('nav: Safety/Disclaimer reachable from nav bar',pg.locator('#tabbar a[data-tab="info"]').count()==1)

    # ================= 3. FIND A PANDAL =================
    go(pg,'find',900)
    c=counts(pg); ok('find: map markers == mappable listed pandals (4 of 6); list shows all 6',c['pandalMarkers']==4 and c['pandalCards']==6,c)
    ok('find: results show name + locality/landmark',pg.evaluate("[...document.querySelectorAll('#pandal-list .result')].every(b=>b.querySelector('.r-name').textContent&&b.querySelector('.r-sub')&&b.querySelector('.r-sub').textContent.length>3)"))
    ok('find: no Directions action until a pandal is selected',pg.locator('#view-find a:has-text("Directions")').count()==0 and not vis(pg,'#pandal-detail'))
    pg.fill('#q','sample pandal b'); pg.wait_for_timeout(250)
    c=counts(pg); ok('find: search narrows list and map together',c['pandalCards']<6 and 1<=c['pandalMarkers']<=c['pandalCards'] and 'Showing' in pg.inner_text('#filter-summary'),c)
    pg.fill('#q','fountain'); pg.wait_for_timeout(250); ok('find: search matches landmark text',pg.locator('#pandal-list .result').count()==1)
    pg.fill('#q','zzzz'); pg.wait_for_timeout(250)
    ok('find: empty state with clear action; zero markers',vis(pg,'#pandal-empty') and 'No pandals match' in pg.inner_text('#pandal-empty') and counts(pg)['pandalMarkers']==0)
    pg.screenshot(path=SHOTS+'03-find-empty.png')
    pg.click('#pandal-empty [data-action="clear-filters"]'); pg.wait_for_timeout(250); ok('find: empty-state clear resets',counts(pg)['pandalCards']==6 and pg.input_value('#q')=='')
    pg.select_option('#locality','Sample Locality One (demo)'); pg.wait_for_timeout(250); ok('find: locality filter works',counts(pg)['pandalCards']==2)
    pg.click('#clear-filters'); pg.wait_for_timeout(200)
    GM='https://www.google.com/maps/dir/?api=1&destination='
    pg.click('#pandal-list [data-id="demo-pandal-a"]'); pg.wait_for_timeout(700)
    ok('find: selecting updates hash and shows the detail panel',pg.evaluate("location.hash")=='#/find/demo-pandal-a' and vis(pg,'#pandal-detail') and 'Sample Pandal A' in pg.inner_text('#pandal-detail'))
    ok('find: ONE primary action "Directions"',pg.locator('#pandal-detail a.btn-primary, #pandal-detail button.btn-primary').count()==1 and pg.locator('#pandal-detail .btn-primary').text_content().strip().startswith('Directions'),[pg.locator('#pandal-detail a.btn-primary, #pandal-detail button.btn-primary').count(),pg.locator('#pandal-detail .btn-primary').count(),pg.inner_text('#pandal-detail')[-200:]])
    a=pg.locator('#pandal-detail a.btn-primary')
    ok('find: Directions = exact Google Maps URL to pandal point (entrance not verified)',a.get_attribute('href')==GM+'26.7271%2C88.3953' and a.get_attribute('target')=='_blank' and set(a.get_attribute('rel').split())>={'noopener','noreferrer'},a.get_attribute('href'))
    dt=pg.inner_text('#pandal-detail')
    ok('find: says plainly that the entrance is NOT verified; shows location (area, landmark, address)','Not verified' in dt and 'Landmark' in dt and 'Address' in dt and 'Area' in dt,dt[:300])
    ok('find: disclaimer visible in directions panel and verbatim',DISCLAIMER in pg.inner_text('#view-find'))
    ok('find: map shows selection (pandal ring) and unverified entrance marker labelled',pg.evaluate("PujaApp.info().selected")=='demo-pandal-a' and pg.locator('#map-find .mk-entr').count()==1)
    pg.screenshot(path=SHOTS+'02-find-selected-directions.png')
    go(pg,'find'); pg.evaluate("PujaApp.map('find').setView([26.7271,88.3953],18,{animate:false})"); pg.wait_for_timeout(500)
    pg.locator('#map-find .leaflet-marker-icon:has(.mk-pandal)').first.click(); pg.wait_for_timeout(600)
    ok('find: tapping a map marker selects that pandal (hash + detail panel with Directions)',pg.evaluate("location.hash").startswith('#/find/demo-pandal-') and vis(pg,'#pandal-detail') and pg.locator('#pandal-detail a.btn-primary').count()==1,pg.evaluate("location.hash"))
    go(pg,'find/demo-pandal-e'); a=pg.locator('#pandal-detail a.btn-primary')
    ok('find: address-only pandal -> Directions via encoded address',a.get_attribute('href')==GM+urllib.request.quote('Sample address E, Siliguri, West Bengal (demo - address only)',safe="()'!*~"),a.get_attribute('href'))
    go(pg,'find/demo-pandal-f')
    ok('find: no location -> Directions disabled with explanation',pg.locator('#pandal-detail a.btn-primary').count()==0 and pg.locator('#pandal-detail button.btn-primary[disabled]').count()==1 and 'Directions unavailable' in pg.inner_text('#pandal-detail'))
    go(pg,'find/not-a-real-id'); ok('find: unknown pandal id handled',vis(pg,'#pandal-detail') and 'not in the current data' in pg.inner_text('#pandal-detail'))
    go(pg,'find/demo-pandal-a'); pg.click('#pandal-detail [data-action="close-detail"]'); pg.wait_for_timeout(300)
    ok('find: Close clears selection',pg.evaluate("location.hash")=='#/find' and not vis(pg,'#pandal-detail'))
    # geolocation only on tap
    ok('geo: explanation shown before any request',vis(pg,'#nearby-intro') and 'permission only after you tap' in pg.inner_text('#nearby-intro') and pg.evaluate("window.__geo")==0)
    pg.click('#nearby-btn'); pg.wait_for_timeout(900)
    ok('geo: denied -> friendly message; app still fully works',pg.evaluate("window.__geo")==1 and 'not granted' in pg.inner_text('#geo-msg') and pg.locator('#pandal-list .result').count()==6,pg.inner_text('#geo-msg'))
    go(pg,'find/demo-pandal-a'); ok('geo: Directions still works without location',pg.locator('#pandal-detail a.btn-primary').count()==1)
    pg.screenshot(path=SHOTS+'04-geolocation-denied.png')
    ok('find: no horizontal scroll',not hscroll(pg))

    # ================= 4. PARKING & WALKING (demo) =================
    go(pg,'parking',900); pt=view_text(pg,'parking')
    ok('parking: disclaimer present, verbatim',DISCLAIMER in pt)
    c=counts(pg); ok('parking: 6 point records (2 parking + 4 access) listed; 6 markers',c['pointCards']==6 and c['pointMarkers']==6,c)
    ok('parking: demo points NOT labelled approved/designated/verified',not any(w in pt for w in ('Approved parking','Designated drop-off','Designated pick-up','Designated pedestrian')) and 'not verified' in pt.lower())
    ok('parking: no "verified" claim anywhere in demo parking view (only "not verified"/"unverified")','verified' not in re.sub(r'not verified|unverified|marked verified','',pt,flags=re.I).lower(),[l for l in pt.split('\n') if 'verified' in re.sub(r'not verified|unverified|marked verified','',l,flags=re.I).lower()][:5])
    chip(pg,'ptype','drop-off'); ok('parking: filter drop-off',counts(pg)['pointCards']==1 and 'drop-off' in pg.inner_text('#point-list').lower())
    chip(pg,'ptype','pick-up'); ok('parking: filter pick-up',counts(pg)['pointCards']==1)
    chip(pg,'ptype','pedestrian'); ok('parking: filter pedestrian entrance/exit (2)',counts(pg)['pointCards']==2)
    chip(pg,'ptype','parking'); ok('parking: filter parking (2)',counts(pg)['pointCards']==2)
    chip(pg,'ptype','all')
    ok('routes: both demo routes listed, each says "not verified", no distance or time shown',pg.locator('#route-list .card').count()==2 and 'Walking distance and time: not available' in pt and 'about' not in pg.inner_text('#route-list').lower().replace('about this','') ,pg.inner_text('#route-list')[:300])
    pg.click('#route-list [data-id="demo-route-1"] [data-action="show-route"]'); pg.wait_for_timeout(600)
    ok('routes: unverified route -> NO line drawn on the map (no straight-line fake)',counts(pg)['routeLines']==0 and pg.locator('#map-parking path.leaflet-interactive').count()==0)
    ok('routes: unverified instructions labelled "do not rely"','do not rely' in pg.inner_text('#route-list [data-id="demo-route-1"]').lower())
    ok('routes: external-navigation caveat present','may not know local Puja restrictions' in pg.inner_text('#route-list'))
    ok('routes: route with no details says so','Walking instructions: not published' in pg.inner_text('#route-list [data-id="demo-route-2"]'))
    ok('parking: no turn-by-turn engine / no routing requests',not [u for u in reqs if any(x in u for x in ('osrm','routing','valhalla','graphhopper','mapbox'))])
    pg.screenshot(path=SHOTS+'05-parking-routes-demo.png')
    ok('parking: no horizontal scroll',not hscroll(pg))

    # ================= 5. TRAFFIC (demo) =================
    go(pg,'traffic',900); tt=view_text(pg,'traffic')
    ok('traffic: disclaimer verbatim + permanent police notice',DISCLAIMER in tt and 'Follow the directions of traffic police' in tt)
    set_time(pg,'2026-10-18T23:30'); s=states(pg,'#view-traffic')
    ok('traffic demo: every sample/unverified record is labelled "Unverified" (never Active/Upcoming)',set(s.values())=={'Unverified'} and len(s)==7,s)
    ok('traffic demo: nothing listed under Active/Upcoming sections',pg.locator('#rs-active .card, #rs-upcoming .card').count()==0 and 'does not mean roads are unrestricted' in pg.inner_text('#rs-active'))
    ok('traffic: label text, not colour only (icon + word)',pg.evaluate("[...document.querySelectorAll('.state')].every(e=>e.querySelector('.ic')&&e.querySelector('.st-t').textContent.trim().length>=6)"))
    ok('traffic: wording never says open/clear/safe/live',not any(w in tt.lower() for w in ('is open','are open','road is clear','safe to drive','confirmed live','currently closed')))
    card=pg.inner_text('#view-traffic [data-id="demo-restr-night-recurring"]')
    ok('traffic card: road/stretch, direction, vehicles, IST schedule, pedestrian "not verified"','Road / stretch' in card and 'Direction' in card and 'Vehicles affected' in card and 'IST' in card and 'Pedestrian access' in card and 'not verified' in card,card[:600])
    ok('traffic card: diversion points linked to the restriction, concise instruction','Diversion points' in card and '[sample]' in card)
    ok('traffic: check summary shows selected IST time','18 Oct 2026, 11:30 PM IST' in pg.inner_text('#check-summary'))
    set_time(pg,'2026-10-19T04:59'); ok('traffic boundary 04:59 inside overnight window (detail: current window ends)','Current window ends' in pg.inner_text('#view-traffic [data-id="demo-restr-night-recurring"]'))
    set_time(pg,'2026-10-19T05:00'); ok('traffic boundary 05:00 outside (end exclusive) -> next window','Next window' in pg.inner_text('#view-traffic [data-id="demo-restr-night-recurring"]'))
    set_time(pg,'2026-10-22T06:00'); ok('traffic after last window -> ended / expired text','Last window ended' in pg.inner_text('#view-traffic [data-id="demo-restr-night-recurring"]') and 'Last window ended' in pg.inner_text('#view-traffic [data-id="demo-restr-multiday"]'))
    set_time(pg,'2026-10-18T23:30')
    ok('traffic map: demo has 3 restriction markers, 3 diversion markers, no drawn geometry',counts(pg)['restrictionMarkers']==3 and counts(pg)['diversionMarkers']==3 and counts(pg)['roadLines']==0)
    pg.screenshot(path=SHOTS+'06-traffic-demo.png')
    pg.click('#check-now'); pg.wait_for_timeout(150); ok('traffic: "use current time" clears override',pg.input_value('#check-at')=='')
    ok('traffic: no horizontal scroll',not hscroll(pg))

    # ================= 6. HELP (demo) =================
    go(pg,'help',900); ht=view_text(pg,'help')
    ok('help: emergency 112 notice; disclaimer present',('112' in ht) and DISCLAIMER in ht)
    ok('help: 5 facility cards; map is empty by default (on demand)',counts(pg)['facilityCards']==5 and counts(pg)['facilityMarkers']==0 and 'on the map' in pg.inner_text('#help-map-note').lower() or counts(pg)['facilityMarkers']==0)
    chip(pg,'ftype','hospital'); ok('help: type filter hospitals',counts(pg)['facilityCards']==1 and counts(pg)['facilityMarkers']==0)
    ok('help: demo hospital shows NO phone and no emergency-capable claim',pg.locator('#fac-list a[href^="tel:"]').count()==0 and 'not verified' in pg.inner_text('#fac-list') and 'confirmed by the source' not in pg.inner_text('#fac-list'))
    chip(pg,'ftype','all'); pg.check('#help-show-map'); pg.wait_for_timeout(500)
    ok('help: "show on map" toggle adds all 5 markers',counts(pg)['facilityMarkers']==5)
    pg.uncheck('#help-show-map'); pg.wait_for_timeout(400); ok('help: toggling off removes them',counts(pg)['facilityMarkers']==0)
    pg.click('#fac-list [data-id="demo-toilet-1"] [data-action="show-fac"]'); pg.wait_for_timeout(500)
    ok('help: single facility on tap -> 1 marker',counts(pg)['facilityMarkers']==1)
    ok('help: each facility has Directions link (Google URL) + hours/landmark text',pg.locator('#fac-list a:has-text("Directions")').count()==5 and all(h.startswith(GM) for h in pg.eval_on_selector_all('#fac-list a:has-text("Directions")','e=>e.map(x=>x.href)')))
    ok('help: demo facilities labelled demo/unverified',pg.locator('#fac-list .badge-demo').count()==5)
    pg.screenshot(path=SHOTS+'07-help-demo.png')

    # ================= 7. INFO / disclaimer =================
    go(pg,'info',500); it=view_text(pg,'info')
    ok('info: disclaimer verbatim',DISCLAIMER in it)
    ok('info: freshness, refresh button, label explanations','Refresh' in it and ('Unverified' in it) and 'IST' in pg.inner_text('#freshness'),pg.inner_text('#freshness'))
    pg.screenshot(path=SHOTS+'08-info-disclaimer.png')
    # disclaimer on every navigation/traffic/directions screen
    for r in ('find','find/demo-pandal-a','parking','traffic','help','info'):
        go(pg,r,300); ok('disclaimer verbatim on #/%s'%r,pg.evaluate("[...document.querySelectorAll('.view:not([hidden]) [data-disclaimer]')].some(e=>e.textContent.includes(%s))"%json.dumps(DISCLAIMER)))
    # touch targets, fonts, a11y
    for r in ('find/demo-pandal-a','parking','traffic','help','info'):
        go(pg,r,500)
        small=pg.evaluate("""()=>{const o=[];document.querySelectorAll('.view:not([hidden]) :is(button,a.btn,a.ba,select,input[type=search],input[type=datetime-local],.result,.chip,summary),#tabbar a,.leaflet-bar a,.leaflet-marker-icon').forEach(e=>{const r=e.getBoundingClientRect();if(r.width&&r.height&&(r.height<43.5||r.width<43.5)&&getComputedStyle(e).visibility!=='hidden')o.push(e.className+':'+Math.round(r.width)+'x'+Math.round(r.height))});return o}""")
        ok('touch targets >=44px on #/%s'%r,not small,small[:6])
    ok('input font-size >= 16px',pg.evaluate("[...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]),select')].every(e=>parseFloat(getComputedStyle(e).fontSize)>=16)"))
    if AXE:
        pg.evaluate(AXE)
        for theme in ('day','dark'):
            if theme=='dark' and pg.evaluate("document.documentElement.dataset.theme")!='dark': go(pg,'',200); pg.click('#theme-btn'); pg.wait_for_timeout(200)
            for r in ('','find/demo-pandal-a','parking','traffic','help','info'):
                go(pg,r,500)
                v=pg.evaluate("axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','best-practice']}}).then(r=>r.violations.map(v=>v.id+' x'+v.nodes.length+': '+v.nodes[0].html.slice(0,90)+' :: '+((v.nodes[0].any[0]||{}).message||'')))")
                ok('axe (%s theme) #/%s: no violations'%(theme,r),not v,v)
            if theme=='dark':
                go(pg,'',300); pg.screenshot(path=SHOTS+'09-dark-home.png'); go(pg,'find/demo-pandal-a',900); pg.screenshot(path=SHOTS+'10-dark-find.png'); go(pg,'traffic',700); pg.screenshot(path=SHOTS+'11-dark-traffic.png')
        ok('theme choice is stored locally only',pg.evaluate("localStorage.getItem('spn.theme')")=='dark')
    ext=sorted({u.split('/')[2] for u in reqs if not u.startswith(ORIGIN) and not u.startswith('data:') and not u.startswith('blob:')})
    ok('only external host contacted is the OSM tile server',ext in([],['tile.openstreetmap.org']),ext)
    ok('no failed (>=400) responses / broken relative paths',not bad,bad)
    ok('no console errors/warnings across all demo flows',not errs,errs)
    ok('geolocation was requested exactly once (user tap) in the whole session',pg.evaluate("window.__geo")==1)
    ok('localStorage holds no location data',pg.evaluate("Object.keys(localStorage).every(k=>['spn.lastRefresh','spn.theme'].includes(k))"))
    ctx.close()

    # ================= 8. geolocation granted =================
    ctx=new_ctx(permissions=['geolocation'],geolocation={'latitude':26.7345,'longitude':88.401}); pg=ctx.new_page(); errs=[]; watch(pg,errs); goto(pg,'find')
    ok('geo granted: still nothing requested before tap',pg.evaluate("document.getElementById('geo-msg').textContent")=='' or 'Asking' not in pg.inner_text('#geo-msg'))
    pg.click('#nearby-btn'); pg.wait_for_timeout(900)
    ids=pg.eval_on_selector_all('#pandal-list .result','e=>e.map(x=>x.dataset.id)')
    ok('geo granted: list sorted by straight-line distance, labelled as straight-line, user marker drawn',ids[0]=='demo-pandal-b' and pg.locator('.r-dist').count()==4 and 'straight line' in pg.inner_text('.r-dist').lower() and pg.locator('.mk-me').count()==1,ids)
    pg.screenshot(path=SHOTS+'12-geolocation-granted.png')
    pg.click('#nearby-clear'); pg.wait_for_timeout(200); ok('geo: "forget" clears distances and marker',pg.locator('.r-dist').count()==0 and pg.locator('.mk-me').count()==0)
    ok('geo: location never stored',pg.evaluate("JSON.stringify([localStorage,sessionStorage,document.cookie]).indexOf('26.73')<0") and not errs,errs)
    ctx.close()
    ctx=new_ctx(permissions=['geolocation'],geolocation={'latitude':28.6139,'longitude':77.2090}); pg=ctx.new_page(); goto(pg,'find'); pg.click('#nearby-btn'); pg.wait_for_timeout(900)
    ok('geo: outside-Siliguri location handled honestly','outside the Siliguri area' in pg.inner_text('#geo-msg'),pg.inner_text('#geo-msg')); ctx.close()

    # ================= 9. verified fixture =================
    ctx=new_ctx(); pg=ctx.new_page(); errs=[]; watch(pg,errs); fx_reqs=[]
    serve_json(pg,verified_fixture(),counter=fx_reqs); goto(pg,'find/p-ok')
    ok('fixture: non-demo dataset hides the demo banner',not vis(pg,'#bn-demo'))
    q=pg.inner_text('#bn-quality') if vis(pg,'#bn-quality') else ''
    ok('fixture: data-quality warning lists skipped records (bad coords, no provenance, missing source, orphan diversion)',vis(pg,'#bn-quality') and '4 record(s)' in q,q)
    a=pg.locator('#pandal-detail a.btn-primary')
    ok('fixture: VERIFIED public entrance -> Directions targets entrance coordinates',a.get_attribute('href')==GM+'26.7275%2C88.3958',a.get_attribute('href'))
    dt=pg.inner_text('#pandal-detail')
    ok('fixture: detail names the verified entrance and says verified',('Fixture main gate' in dt) and ('verified' in dt.lower()),dt[:400])
    ok('fixture: entrance markers drawn (verified + unverified entrance)',pg.locator('#map-find .mk-entr').count()==2)
    pg.screenshot(path=SHOTS+'13-find-verified-entrance.png')
    go(pg,'find/p-unv'); a=pg.locator('#pandal-detail a.btn-primary')
    ok('fixture: entrance claimed verified on an UNVERIFIED pandal is ignored (pandal point used)',a.get_attribute('href')==GM+'26.7222%2C88.3922' and 'Not verified' in pg.inner_text('#pandal-detail'),a.get_attribute('href'))
    # xss
    go(pg,'find/p-xss'); go(pg,'traffic'); go(pg,'parking'); go(pg,'find')
    pg.fill('#q','Evil'); pg.wait_for_timeout(200)
    ok('XSS: hostile strings rendered as text only',pg.evaluate("window.__xss===undefined") and pg.locator('#pandal-list img, #pandal-list script, #view-traffic .card img, #view-traffic .card script').count()==0 and not [e for e in errs if 'DIALOG' in e],errs)
    pg.fill('#q',''); pg.wait_for_timeout(100)
    # parking
    go(pg,'parking',900); pc=pg.inner_text('#point-list'); 
    ok('fixture parking: explicit flags show "Approved parking" / "Designated drop-off" ONLY on verified+flagged records',
       'Approved parking' in pg.inner_text('#point-list [data-id="k-ok"]') and 'Designated drop-off' in pg.inner_text('#point-list [data-id="a-drop"]') and 'Designated pick-up' not in pg.inner_text('#point-list [data-id="a-pick"]'),pc[:1500])
    rv=pg.inner_text('#route-list [data-id="w-ok"]'); ru=pg.inner_text('#route-list [data-id="w-unv"]')
    ok('fixture routes: verified route shows distance (m), time (min), instructions, from/to','1800 m' in rv and '25 min' in rv and 'Walk north along Fixture Rd.' in rv and 'Fixture Parking' in rv and 'Fixture main gate' in rv,rv)
    ok('fixture routes: unverified route hides distance/time even though provided in the JSON','300' not in ru and ' 4 min' not in ru and 'not verified' in ru.lower() and 'do not rely' in ru.lower(),ru)
    pg.click('#route-list [data-id="w-ok"] [data-action="show-route"]'); pg.wait_for_timeout(700)
    ok('fixture routes: verified route draws its waypoint polyline (3 vertices)',counts(pg)['routeLines']==1 and pg.evaluate("(()=>{let n=0;PujaApp.map('parking').eachLayer(l=>{if(l instanceof L.Polyline&&!(l instanceof L.Polygon)){n=l.getLatLngs().length}});return n})()")==3)
    pg.screenshot(path=SHOTS+'14-parking-verified-route.png')
    pg.click('#route-list [data-id="w-unv"] [data-action="show-route"]'); pg.wait_for_timeout(500)
    ok('fixture routes: switching to the unverified route removes the line',counts(pg)['routeLines']==0)
    # traffic
    go(pg,'traffic',700); set_time(pg,'2026-10-18T12:00')
    a=states(pg,'#rs-active'); u=states(pg,'#rs-upcoming'); o=states(pg,'#rs-other')
    ok('fixture @18 Oct 12:00 IST: Active = r-active, r-geo (labelled "Active")',a=={'r-active':'Active','r-geo':'Active'},a)
    ok('fixture @18 Oct 12:00: Upcoming labelled "Upcoming"',set(u)=={'r-night','r-future','r-xss'} and set(u.values())=={'Upcoming'},u)
    ok('fixture @18 Oct 12:00: expired -> "Expired", cancelled -> "Cancelled", unconfirmed -> "Unverified"',o=={'r-expired':'Expired','r-cancel':'Cancelled','r-unconf':'Unverified'},o)
    ca=pg.inner_text('#view-traffic [data-id="r-active"]')
    ok('fixture traffic card: wording "per published schedule", never "open/clear"','per published schedule' in ca and 'Fixture Rd, A to B' in ca and 'Both directions' in ca and 'cars' in ca and '18 Oct 2026, 10:00 AM IST' in ca and '8:00 PM IST' in ca,ca)
    ok('fixture traffic card: pedestrian access shown for VERIFIED record only','north footpath' in ca and 'Pedestrians always allowed' not in pg.inner_text('#view-traffic [data-id="r-unconf"]') and 'not verified' in pg.inner_text('#view-traffic [data-id="r-unconf"]'))
    ok('fixture traffic card: diversion point linked, with concise turning instruction and landmark','Fixture: turn left at the fixture junction.' in ca and 'Fixture junction' in ca and 'Orphan diversion' not in pg.inner_text('#view-traffic'))
    ok('fixture traffic: verified geometry drawn (1 road line); diversion marker present',counts(pg)['roadLines']==1 and counts(pg)['diversionMarkers']==1,counts(pg))
    set_time(pg,'2026-10-19T04:59'); ok('fixture boundary: 04:59 night window Active',states(pg,'#rs-active').get('r-night')=='Active')
    set_time(pg,'2026-10-19T05:00'); ok('fixture boundary: 05:00 night window not Active (Upcoming)',states(pg,'#rs-upcoming').get('r-night')=='Upcoming' and 'r-night' not in states(pg,'#rs-active'))
    set_time(pg,'2026-10-18T20:00'); ok('fixture boundary: end instant => r-active is Expired, not Active',states(pg,'#rs-other').get('r-active')=='Expired' and 'r-active' not in states(pg,'#rs-active'),states(pg,'#rs-other'))
    set_time(pg,'2026-10-18T12:00'); pg.screenshot(path=SHOTS+'15-traffic-fixture-states.png')
    # help
    go(pg,'help',700); ft=pg.inner_text('#fac-list [data-id="f-hosp"]'); fn=pg.inner_text('#fac-list [data-id="f-hosp2"]')
    ok('fixture help: verified + authorised hospital shows phone (tel link) and emergency capability',pg.locator('#fac-list [data-id="f-hosp"] a[href^="tel:"]').count()==1 and 'confirmed by the source' in ft,ft)
    ok('fixture help: hospital without authorisation shows no phone and no capability claim','+91' not in fn and pg.locator('#fac-list [data-id="f-hosp2"] a[href^="tel:"]').count()==0 and 'not verified' in fn,fn)
    pg.screenshot(path=SHOTS+'16-help-fixture.png')
    ok('fixture: no console errors / dialogs',not errs,errs)
    ctx.close()

    # ================= 10. REFRESH: concurrency, manual, foreground, periodic, failure =================
    ctx=new_ctx(); pg=ctx.new_page(); errs=[]; watch(pg,errs); creq=[]
    serve_json(pg,DEMO,counter=creq); goto(pg,'',700)
    st0=pg.evaluate("PujaApp.refreshStats()"); n0=len(creq)
    ok('refresh: fetches fresh data on open (no-store + cache-bust param)',n0==1 and 'cb=' in creq[0],creq)
    ok('refresh: info shows network source, last refresh stored',info(pg)['source']=='network' and not info(pg)['stale'] and pg.evaluate("+localStorage.getItem('spn.lastRefresh')")>1e12)
    pg.evaluate("window.__cc=[...Array(12)].map(()=>PujaApp.refresh('manual'))"); pg.wait_for_timeout(500)
    st1=pg.evaluate("PujaApp.refreshStats()")
    ok('refresh: 12 concurrent/rapid calls -> at most ONE extra network request, rest skipped (in-flight guard + rate limit)',len(creq)-n0<=1 and st1['skipped']>=st0['skipped']+11-1 and st1['inFlight'] is False,(len(creq)-n0,st1))
    n1=len(creq); pg.click('#view-home [data-action="refresh"]'); pg.wait_for_timeout(300)
    ok('refresh: manual button inside the 3 s limit is rate-limited (no extra request)',len(creq)==n1)
    pg.wait_for_timeout(3000); pg.click('#view-home [data-action="refresh"]'); pg.wait_for_timeout(500)
    ok('refresh: manual button after the limit fetches again',len(creq)==n1+1,len(creq)-n1)
    # foreground
    n2=len(creq); pg.wait_for_timeout(100)
    pg.evaluate("window.__t0=Date.now()")
    set_visibility(pg,'hidden'); pg.wait_for_timeout(300); ok('refresh: hiding the page does not fetch',len(creq)==n2)
    ctx.close()
    # fake clock for foreground + periodic
    ctx=new_ctx(); pg=ctx.new_page(); errs=[]; watch(pg,errs); creq=[]; serve_json(pg,DEMO,counter=creq)
    pg.clock.install(); goto(pg,'',300); pg.clock.run_for(1000); pg.wait_for_timeout(300)
    n=len(creq); ok('clock: initial open fetch happened once',n==1,n)
    set_visibility(pg,'hidden'); pg.clock.run_for(5*60000+1000); pg.wait_for_timeout(200)
    ok('refresh: periodic timer does NOT fetch while page hidden',len(creq)==n,len(creq)-n)
    set_visibility(pg,'visible'); pg.clock.run_for(100); pg.wait_for_timeout(300)
    ok('refresh: return to foreground (visibilitychange) fetches',len(creq)==n+1,len(creq)-n)
    n=len(creq); pg.clock.run_for(5*60000+1000); pg.wait_for_timeout(300)
    ok('refresh: periodic refresh about every 5 min while visible',len(creq)==n+1,len(creq)-n)
    n=len(creq); pg.clock.run_for(10000); set_visibility(pg,'hidden'); set_visibility(pg,'visible'); pg.clock.run_for(100); pg.wait_for_timeout(200)
    ok('refresh: rapid hide/show within 30 s is rate-limited',len(creq)==n,len(creq)-n)
    ok('refresh clock: no errors',not errs,errs)
    ctx.close()
    # failure keeps data
    ctx=new_ctx(); pg=ctx.new_page(); errs=[]; watch(pg,errs); mode={'m':'ok'}; seen=[]
    def flaky(r):
        seen.append(1)
        if mode['m']=='ok': r.fulfill(status=200,content_type='application/json',body=json.dumps(DEMO))
        elif mode['m']=='abort': r.abort('internetdisconnected')
        elif mode['m']=='500': r.fulfill(status=500,body='oops')
        elif mode['m']=='bad': r.fulfill(status=200,content_type='application/json',body='{not json')
        elif mode['m']=='empty': r.fulfill(status=200,content_type='application/json',body='{"meta":{}}')
    pg.route('**/data/puja-data.json*',flaky); goto(pg,'',700)
    t_ok=pg.evaluate("localStorage.getItem('spn.lastRefresh')"); fr_ok=pg.inner_text('#view-home [data-fresh]')
    ok('failure: healthy state has no stale banner and normal freshness text',not vis(pg,'#bn-offline') and fr_ok.startswith('Data updated') and 'outdated' not in fr_ok,fr_ok)
    for m in ('abort','500','bad','empty'):
        mode['m']=m; pg.wait_for_timeout(3200); pg.evaluate("PujaApp.refresh('manual')"); pg.wait_for_timeout(700)
        ok('failure (%s): keeps cached data in view, shows "may be outdated" banner, still labels demo'%m,counts(pg)['pandalCards']==6 and vis(pg,'#bn-offline') and 'may be outdated' in pg.inner_text('#bn-offline') and info(pg)['stale'] is True,pg.inner_text('#bn-offline') if vis(pg,'#bn-offline') else 'no banner')
        ok('failure (%s): last successful refresh time NOT advanced; freshness text says may be outdated and keeps old time'%m,pg.evaluate("localStorage.getItem('spn.lastRefresh')")==t_ok and 'may be outdated' in pg.inner_text('#view-home [data-fresh]') and 'Last successful refresh' in pg.inner_text('#view-home [data-fresh]'),pg.inner_text('#view-home [data-fresh]'))
    pg.screenshot(path=SHOTS+'17-refresh-failed-stale.png')
    go(pg,'traffic',400); ok('failure: traffic screen warns statuses may be outdated',vis(pg,'#restr-cache-note') and 'outdated' in pg.inner_text('#restr-cache-note'))
    mode['m']='ok'; pg.wait_for_timeout(3200); go(pg,'',200); pg.evaluate("PujaApp.refresh('manual')"); pg.wait_for_timeout(700)
    ok('recovery: next successful refresh clears the stale state and updates the time',not vis(pg,'#bn-offline') and not info(pg)['stale'] and pg.evaluate("localStorage.getItem('spn.lastRefresh')")!=t_ok and 'outdated' not in pg.inner_text('#view-home [data-fresh]'))
    ok('failure scenarios: no uncaught page errors',not [e for e in errs if 'PAGEERROR' in e],errs[:3])
    ctx.close()
    # initial failures -> unavailable
    for name,kw in (('HTTP 404',dict(status=404,body='nope')),('HTTP 500',dict(status=500,body='x')),('invalid JSON',dict(body='{oops')),('missing meta/lists',dict(body='[]')),('empty body',dict(body=''))):
        ctx=new_ctx(); pg=ctx.new_page(); errs=[]; watch(pg,errs); serve_json(pg,kw.get('body',''),status=kw.get('status',200)); goto(pg,'find',700)
        t=pg.inner_text('#bn-unavailable') if vis(pg,'#bn-unavailable') else ''
        ok('startup %s: "Data unavailable" shown, no data invented, app usable, no road claims'%name,'Data unavailable' in t and counts(pg)['pandalCards']==0 and 'Data unavailable' in pg.inner_text('#pandal-empty') and 'is open' not in t and not [e for e in errs if 'PAGEERROR' in e],(t,errs))
        if name=='invalid JSON':
            go(pg,'parking',300); go(pg,'traffic',300); go(pg,'help',300)
            ok('startup invalid JSON: every screen says unavailable (no blank lists) and keeps the disclaimer','unavailable' in pg.inner_text('#view-help').lower() and 'unavailable' in pg.inner_text('#view-traffic').lower() and DISCLAIMER in pg.inner_text('#view-traffic'))
            go(pg,'',300); ok('startup invalid JSON: freshness says no successful refresh',pg.inner_text('#view-home [data-fresh]').lower().startswith('no') or 'unavailable' in pg.inner_text('#view-home [data-fresh]').lower() or 'not' in pg.inner_text('#view-home [data-fresh]').lower(),pg.inner_text('#view-home [data-fresh]'))
            pg.screenshot(path=SHOTS+'18-data-unavailable.png')
        ctx.close()
    # network down at startup
    ctx=new_ctx(); pg=ctx.new_page(); errs=[]; watch(pg,errs); pg.route('**/data/puja-data.json*',lambda r: r.abort('internetdisconnected')); goto(pg,'find',700)
    ok('startup network error: unavailable shown; Retry button present',vis(pg,'#bn-unavailable') and pg.locator('#bn-unavailable [data-action="refresh"]').count()==1)
    ctx.close()
    # records missing coordinates / empty sections
    mini=copy.deepcopy(DEMO); mini['pandals']=[x for x in mini['pandals'] if x['id'] in('demo-pandal-f',)]; mini['walkingRoutes']=[]; mini['diversionPoints']=[]; mini['facilities']=[]; mini['accessPoints']=[]; mini['parking']=[]
    ctx=new_ctx(); pg=ctx.new_page(); errs=[]; watch(pg,errs); serve_json(pg,mini); goto(pg,'find',700)
    ok('missing coords: pandal still listed, zero markers, Directions disabled',counts(pg)['pandalCards']==1 and counts(pg)['pandalMarkers']==0)
    go(pg,'parking',300); go(pg,'help',300)
    ok('empty lists: honest "none published yet" messages (no blank sections)','No points of this kind have been published yet' in pg.content() or 'published yet' in pg.inner_text('#view-parking'))
    ok('empty facility list: 112 hint','No facilities have been published yet' in pg.inner_text('#view-help') and '112' in pg.inner_text('#view-help'))
    ok('missing coords: no console errors',not errs,errs); ctx.close()

    # ================= 11. desktop =================
    ctx=new_ctx(mobile=False); pg=ctx.new_page(); errs=[]; watch(pg,errs); goto(pg,'find',900)
    ok('desktop: renders, no h-scroll, no errors',counts(pg)['pandalMarkers']==4 and not hscroll(pg) and not errs,errs)
    pg.screenshot(path=SHOTS+'19-desktop-find.png'); ctx.close()

    # ================= 12. file:// =================
    ctx=new_ctx(); pg=ctx.new_page(); errs=[]; watch(pg,errs)
    pg.goto('file://'+ROOT+'/index.html'); pg.wait_for_timeout(1200)
    ok('file://: shell renders, data-unavailable explanation, no console errors',vis(pg,'#bn-unavailable') and 'local file' in pg.inner_text('#bn-unavailable') and not errs,errs); ctx.close()

    # ================= 13. admin preview unchanged & separate =================
    ctx=new_ctx(); pg=ctx.new_page(); errs=[]; watch(pg,errs)
    pg.goto(BASE+'admin-preview.html'); pg.wait_for_selector('#json')
    pg.fill('#json',json.dumps(DEMO)); pg.fill('#at','2026-10-18T23:30'); pg.click('#go'); pg.wait_for_timeout(300)
    ok('admin preview: still validates the demo data (new kinds accepted)','All records valid' in pg.inner_text('#out') or 'SKIPPED' not in pg.inner_text('#out'),pg.inner_text('#out')[:300])
    pg.fill('#json','{oops'); pg.click('#go'); ok('admin preview: invalid JSON explained','NOT VALID JSON' in pg.inner_text('#out'))
    ok('admin preview: no console errors',not errs,errs); ctx.close()

    # ================= 14. service worker / offline =================
    ctx=new_ctx(sw='allow'); pg=ctx.new_page(); errs=[]; watch(pg,errs); goto(pg,'',800)
    pg.evaluate("navigator.serviceWorker.ready.then(()=>1)"); pg.wait_for_timeout(1500); pg.reload(); pg.wait_for_selector('#main',state='attached'); pg.wait_for_timeout(1000)
    ok('sw: service worker controls the page',pg.evaluate("!!navigator.serviceWorker.controller"))
    ok('sw: online data is network-sourced, not flagged cached',info(pg)['source']=='network' and not vis(pg,'#bn-offline'))
    n=pg.evaluate("caches.keys().then(async k=>{const o={};for(const x of k){o[x]=(await (await caches.open(x)).keys()).map(r=>new URL(r.url).pathname.split('/').slice(-1)[0])}return o})")
    shell=[v for k,v in n.items() if k.startswith('spn-shell-')][0]
    ok('sw: shell precache has leaflet, cluster, icons, offline.html, app files',all(x in shell for x in ('leaflet.js','leaflet.css','leaflet.markercluster.js','marker-icon.png','offline.html','app.js','logic.js','styles.css','index.html','icon-192.png','manifest.webmanifest')),shell)
    ok('sw: data JSON in separate data cache; exactly one shell cache version',any('puja-data.json' in v for k,v in n.items() if k=='spn-data-v1') and not any('puja-data.json' in x for x in shell) and len([k for k in n if k.startswith('spn-shell-')])==1,list(n))
    last_refresh=pg.evaluate("localStorage.getItem('spn.lastRefresh')")
    pg.wait_for_timeout(1200)
    ctx.set_offline(True); pg.reload(); pg.wait_for_selector('#main',state='attached'); pg.wait_for_timeout(1800)
    go(pg,'find',900)
    ok('offline reload: shell + cached data render',counts(pg)['pandalCards']==6 and counts(pg)['pandalMarkers']==4)
    txt=pg.inner_text('#bn-offline') if vis(pg,'#bn-offline') else ''
    ok('offline: clear banner "saved data may be outdated"','Offline' in txt and 'may be outdated' in txt,txt)
    go(pg,'',200); fr=pg.inner_text('#view-home [data-fresh]')
    ok('offline: freshness label says saved/may be outdated and shows the REAL last network refresh (not the cache-copy time)','may be outdated' in fr and 'IST' in fr and pg.evaluate("localStorage.getItem('spn.lastRefresh')")==last_refresh,fr)
    ok('offline: SW cached copy did not update lastRefresh; info.source=cache',info(pg)['source']=='cache')
    go(pg,'traffic',300); ok('offline: traffic screen cache note + disclaimer',vis(pg,'#restr-cache-note') and DISCLAIMER in pg.inner_text('#view-traffic'))
    go(pg,'',200); pg.screenshot(path=SHOTS+'20-offline-stale-home.png')
    pg.evaluate("PujaApp.refresh('manual')"); pg.wait_for_timeout(1000)
    ok('offline: manual Refresh fails gracefully; stale state remains',info(pg)['stale'] is True or info(pg)['source']=='cache')
    pg.goto(BASE+'some/uncached-page.html'); pg.wait_for_timeout(700)
    ok('offline: uncached navigation shows offline.html',pg.title().startswith('Offline') and 'You are offline' in pg.inner_text('body'),pg.title())
    ctx.set_offline(False); pg.goto(BASE+'index.html'); pg.wait_for_selector('#main',state='attached'); pg.wait_for_timeout(1500)
    ok('back online: fresh data, banners gone, refresh time updated',not vis(pg,'#bn-offline') and pg.evaluate("localStorage.getItem('spn.lastRefresh')")!=last_refresh and info(pg)['source']=='network')
    d2=copy.deepcopy(DEMO); d2['meta']['datasetVersion']='demo-changed'; d2['pandals'][0]['name']='DEMO – Changed Name'
    ctx.route('**/data/puja-data.json*',lambda r: r.fulfill(status=200,content_type='application/json',body=json.dumps(d2)))
    pg.reload(); pg.wait_for_selector('#main',state='attached'); pg.wait_for_timeout(1200); go(pg,'find',300)
    ok('sw: data is network-first - upstream change visible immediately (no stale SW cache)','Changed Name' in pg.inner_text('#pandal-list'),pg.inner_text('#pandal-list')[:100])
    ok('sw/offline: no uncaught page errors',not [e for e in errs if 'PAGEERROR' in e],errs[:3])
    ctx.close()

    # ================= 15. visual refinement checks =================
    # home geometry at 360x740 (card heights are reported; the redesign intentionally replaces the compact 3-row cards)
    ctx=new_ctx(viewport={'width':360,'height':740}); pg=ctx.new_page(); errs=[]; watch(pg,errs); goto(pg,'',700)
    m=pg.evaluate("""()=>{const a=[...document.querySelectorAll('.bigbtn')];const r=a.map(x=>x.getBoundingClientRect());return {h:r.map(x=>Math.round(x.height)),w:r.map(x=>Math.round(x.width)),bottom:Math.round(r[2].bottom),fresh:Math.round(document.querySelector('.fresh-row').getBoundingClientRect().bottom),warn:Math.round(document.querySelector('#view-home .banner-permanent').getBoundingClientRect().bottom),header:Math.round(document.querySelector('#masthead').getBoundingClientRect().height),fam:a.map(x=>getComputedStyle(x.querySelector('.bb-t')).fontFamily),h1:getComputedStyle(document.querySelector('h1')).fontFamily,bg:getComputedStyle(a[0]).backgroundImage}}""")
    print('INFO home 360x740 card heights',m['h'],'header',m['header'],'safety bar bottom',m['warn'])
    ok('visual: primary card has a burgundy gradient fill; titles use sans-serif; app name keeps the serif',('gradient' in m['bg']) and all('Georgia' not in f for f in m['fam']) and 'Georgia' in m['h1'],m)
    ok('visual: freshness row and safety bar are on the first 740 px screen at 360 wide (no scrolling)',m['warn']<=740 and m['fresh']<=740,m)
    ok('visual: header height reasonable (<=190 px at 360 wide, incl. tagline, descriptor, dates)',m['header']<=190,m['header'])
    for i,(href,v) in enumerate((('#/find','find'),('#/parking','parking'),('#/traffic','traffic'))):
        goto(pg,'',300); pg.locator('.bigbtn').nth(i).tap() if False else pg.locator('.bigbtn').nth(i).click(); pg.wait_for_timeout(350)
        ok('visual: whole card %d is clickable and opens %s'%(i+1,v),vis(pg,'#view-'+v) and pg.evaluate("location.hash")==href)
    goto(pg,'',300)
    pg.keyboard.press('Tab'); pg.keyboard.press('Tab'); pg.keyboard.press('Tab')
    foc=pg.evaluate("(()=>{const e=document.activeElement;const cs=getComputedStyle(e);return {c:e.className,ow:cs.outlineWidth,os:cs.outlineStyle}})()")
    ok('visual: keyboard focus ring visible (>=3px outline) on cards/controls',foc['os']!='none' and float(foc['ow'].replace('px',''))>=3,foc)
    ok('visual: no new bottom nav on home, no dialogs / bitmap illustrations on home (inline SVG icons only)',not vis(pg,'#tabbar') and pg.locator('#view-home img, dialog').count()==0 and pg.locator('#view-home svg').count()>=6)
    ok('visual: demo warning compact (<=84 px tall at 360 wide), icon + text',vis(pg,'#bn-demo') and pg.evaluate("document.querySelector('#bn-demo').getBoundingClientRect().height")<=84 and pg.locator('#bn-demo svg').count()==1 and pg.inner_text('#bn-demo').startswith('Demo data – locations and traffic orders are not verified.'),pg.inner_text('#bn-demo'))
    ok('visual: demo warning stays visible on every screen with demo data',all((go(pg,r,250) or True) and vis(pg,'#bn-demo') for r in ('find','parking','traffic','help','info','')))
    # install prompt UI intact (header, compact)
    pg.evaluate("""()=>{const e=new Event('beforeinstallprompt');e.prompt=()=>{window.__prompted=1};e.userChoice=Promise.resolve({outcome:'accepted'});window.dispatchEvent(e)}""")
    ok('install: button appears in the header after beforeinstallprompt, >=44 px',vis(pg,'#install-btn') and pg.evaluate("document.querySelector('#install-btn').getBoundingClientRect().height")>=44 and pg.evaluate("!!document.querySelector('#masthead #install-btn')"))
    pg.screenshot(path=SHOTS+'v3-install-visible-360x740.png')
    pg.click('#install-btn'); pg.wait_for_timeout(200); ok('install: click calls prompt() then hides',pg.evaluate("window.__prompted===1") and not vis(pg,'#install-btn'))
    ok('visual: no console errors at 360x740',not errs,errs); ctx.close()
    # reduced motion
    ctx=new_ctx(reduced_motion='reduce'); pg=ctx.new_page(); goto(pg,'',400)
    ok('visual: prefers-reduced-motion disables transitions/animations',pg.evaluate("[...document.querySelectorAll('.bigbtn,.btn')].every(e=>parseFloat(getComputedStyle(e).transitionDuration)===0)")); ctx.close()
    # overflow at narrow widths, light + night, every route; axe colour contrast on home states
    for (w,h) in ((320,568),(360,740),(375,812),(390,844),(412,915)):
        for theme in ('light','night'):
            ctx=new_ctx(viewport={'width':w,'height':h}); pg=ctx.new_page(); errs=[]; watch(pg,errs); goto(pg,'',500)
            if theme=='night': pg.click('#theme-btn'); pg.wait_for_timeout(150)
            bad_r=[]
            for r in ('','find','find/demo-pandal-a','parking','traffic','help','info'):
                go(pg,r,300)
                o=pg.evaluate("({sw:document.documentElement.scrollWidth,iw:innerWidth,bw:document.body.scrollWidth,wide:[...document.querySelectorAll('.view:not([hidden]) *, #masthead *, #tabbar *')].filter(e=>{const x=e.getBoundingClientRect();return x.width&&x.right>innerWidth+1&&!e.closest('.leaflet-container')}).slice(0,3).map(e=>e.className||e.tagName)})")
                if o['sw']>o['iw'] or o['bw']>o['iw'] or o['wide']: bad_r.append((r,o))
            ok('overflow: no horizontal overflow at %dx%d %s on all screens'%(w,h,theme),not bad_r,bad_r)
            if (w,h) in((320,568),(360,740),(412,915)):
                go(pg,'',300); pg.screenshot(path=SHOTS+'v3-home-%dx%d-%s.png'%(w,h,theme))
                go(pg,'find/demo-pandal-a',700); pg.screenshot(path=SHOTS+'v3-find-%dx%d-%s.png'%(w,h,theme))
                go(pg,'traffic',700); pg.screenshot(path=SHOTS+'v3-traffic-%dx%d-%s.png'%(w,h,theme))
            ok('overflow: no console errors %dx%d %s'%(w,h,theme),not errs,errs)
            ctx.close()
    # axe colour contrast with each freshness / banner state, day + night
    if AXE:
        ctx=new_ctx(viewport={'width':360,'height':740}); pg=ctx.new_page(); errs=[]; watch(pg,errs); mode={'m':'ok'}
        def flaky2(r):
            if mode['m']=='ok': r.fulfill(status=200,content_type='application/json',body=json.dumps(DEMO))
            else: r.abort('internetdisconnected')
        pg.route('**/data/puja-data.json*',flaky2); goto(pg,'',600); pg.evaluate(AXE)
        def contrast(label):
            v=pg.evaluate("axe.run(document,{runOnly:{type:'rule',values:['color-contrast','link-in-text-block']}}).then(r=>r.violations.map(v=>v.id+': '+v.nodes.slice(0,2).map(n=>n.html.slice(0,80)+' '+((n.any[0]||{}).message||'')).join(' || ')))")
            ok('contrast AA (%s)'%label,not v,v)
        for theme in ('light','night'):
            if theme=='night' and pg.evaluate("document.documentElement.dataset.theme")!='dark': pg.click('#theme-btn'); pg.wait_for_timeout(150)
            mode['m']='ok'; pg.wait_for_timeout(3200); pg.evaluate("PujaApp.refresh('manual')"); pg.wait_for_timeout(500)
            go(pg,'',200); contrast('%s, home, demo data, current'%theme)
            mode['m']='fail'; pg.wait_for_timeout(3200); pg.evaluate("PujaApp.refresh('manual')"); pg.wait_for_timeout(600)
            ok('states (%s): failed refresh -> compact stale banner + freshness warns "may be outdated" (text + warning sign)'%theme,vis(pg,'#bn-offline') and 'may be outdated' in pg.inner_text('#view-home [data-fresh]') and pg.evaluate("getComputedStyle(document.querySelector('#view-home [data-fresh]'),'::before').content").strip('"')!='⟳ ' )
            contrast('%s, home, refresh failed / stale'%theme)
            for r in ('find/demo-pandal-a','parking','traffic','help','info'): go(pg,r,250); contrast('%s, #/%s'%(theme,r))
            pg.screenshot(path=SHOTS+'v3-traffic-stale-360x740-%s.png'%theme)
            go(pg,'',200); pg.screenshot(path=SHOTS+'v3-home-stale-360x740-%s.png'%theme)
        ok('contrast pass: no console errors (other than the deliberately aborted refreshes)',not [e for e in errs if 'ERR_INTERNET_DISCONNECTED' not in e],errs); ctx.close()
    # demo banner: present for demo data, absent for a non-demo (verified) dataset, on home too
    ctx=new_ctx(viewport={'width':360,'height':740}); pg=ctx.new_page(); serve_json(pg,verified_fixture()); goto(pg,'',600)
    ok('demo banner: absent on home when the dataset flag says it is not demo',not vis(pg,'#bn-demo'))
    d3=copy.deepcopy(verified_fixture()); d3['meta']['isDemoDataset']=True
    ctx.close(); ctx=new_ctx(viewport={'width':360,'height':740}); pg=ctx.new_page(); serve_json(pg,d3); goto(pg,'',600)
    ok('demo banner: tied to the flag (isDemoDataset=true shows it even for fixture records)',vis(pg,'#bn-demo')); ctx.close()
    # ================= 16. Siliguri Puja Guide redesign: branding, identity strip, responsive cards =================
    import subprocess, tempfile, shutil
    def read_root(f): return open(os.path.join(ROOT,f),encoding='utf8').read()
    # --- branding present everywhere user-visible, old name absent
    ctx=new_ctx(viewport={'width':360,'height':740}); pg=ctx.new_page(); errs=[]; reqs16=[]; watch(pg,errs); pg.on('request',lambda r: reqs16.append(r.url))
    goto(pg,'',700)
    man=json.loads(urllib.request.urlopen(BASE+'manifest.webmanifest').read().decode('utf8'))
    ok('branding: manifest name + short_name',man['name']=='Siliguri Puja Guide' and man['short_name']=='Puja Guide',man)
    ok('branding: apple-mobile-web-app-title and <title>',pg.evaluate("document.querySelector('meta[name=apple-mobile-web-app-title]').content")=='Puja Guide' and pg.title()=='Siliguri Puja Guide')
    off=urllib.request.urlopen(BASE+'offline.html').read().decode('utf8'); adm=urllib.request.urlopen(BASE+'admin-preview.html').read().decode('utf8')
    ok('branding: offline.html and admin preview use the new name',('Offline – Siliguri Puja Guide' in off) and ('Siliguri Puja Guide' in adm))
    allpages=[pg.content(),off,adm,json.dumps(man),urllib.request.urlopen(BASE+'app.js').read().decode('utf8')]
    ok('branding: old name "Siliguri Puja Navigator" absent from built pages, manifest and app code',not any('Siliguri Puja Navigator' in x for x in allpages))
    ok('branding: no "independent community" / endorsed / approved-by wording on visitor pages',not any(w in (pg.content()+off).lower() for w in ('independent community','community tool','endorsed by','approved by')))
    ok('branding: footer is the honest demo line, footer links present',pg.inner_text('#foot-line')=='Siliguri Puja Guide · Durga Puja 2026 · Demo version' and [a.text_content().strip() for a in pg.locator('.footlinks a').element_handles()]==['Safety notice','Privacy policy','Terms of use'],pg.inner_text('#foot-line'))
    ok('branding: no maintainer/admin instructions on visitor screens','ADMIN-GUIDE' not in pg.content() and 'Replace with verified' not in pg.content())
    for lab,anchor in (('Privacy policy','info-privacy'),('Terms of use','info-terms'),('Safety notice','info-safety')):
        goto(pg,'',250); pg.click('.footlinks a:has-text("%s")'%lab); pg.wait_for_timeout(500)
        ok('footer link "%s" opens the info screen at its section'%lab,vis(pg,'#view-info') and pg.evaluate("a=>{const r=document.getElementById(a).getBoundingClientRect();return r.top>=-5&&r.top<innerHeight}",anchor))
    goto(pg,'',250)
    ok('identity strip absent: hidden, takes no space, logo files never requested (no 404s), no broken images',pg.evaluate("(()=>{const s=document.getElementById('idstrip');return s.hidden&&s.getBoundingClientRect().height===0&&!document.getElementById('logo-a').getAttribute('src')&&!document.getElementById('logo-b').getAttribute('src')})()") and not [u for u in reqs16 if 'assets/logos' in u] and not errs,(errs,[u for u in reqs16 if 'logos' in u]))
    ctx.close()

    # --- identity strip with TEMPORARY test-fixture logos (generated in a temp dir, never committed)
    TL=tempfile.mkdtemp(prefix='spn-testlogos-')
    subprocess.run(['python3','-c','''
import sys
from PIL import Image, ImageDraw, ImageFont
d=sys.argv[1]
for name,size,txt,col in (("a.png",(400,520),"TEST LOGO A",(150,170,200,255)),("b.png",(560,440),"TEST LOGO B",(200,170,150,255))):
    im=Image.new("RGBA",size,(0,0,0,0)); dr=ImageDraw.Draw(im)
    dr.rounded_rectangle([4,4,size[0]-5,size[1]-5],radius=40,fill=col,outline=(60,60,60,255),width=8)
    try: f=ImageFont.load_default(size=52)
    except TypeError: f=ImageFont.load_default()
    dr.text((size[0]//2,size[1]//2),txt,fill=(20,20,20,255),font=f,anchor="mm")
    im.save(d+"/"+name)
''',TL],check=True)
    def strip_ctx(w,h,present=True,enabled=True,logo_status=(200,200),**kw):
        c=new_ctx(viewport={'width':w,'height':h},**kw)
        src=read_root('branding.js').replace('logosPresent: false','logosPresent: %s'%('true' if present else 'false')).replace('enabled: true,','enabled: %s,'%('true' if enabled else 'false'))
        c.route('**/branding.js',lambda r: r.fulfill(status=200,content_type='application/javascript',body=src))
        for key,fn,st in (('west-bengal-police','a.png',logo_status[0]),('siliguri-metropolitan-police','b.png',logo_status[1])):
            c.route('**/assets/logos/%s.png'%key,(lambda fn,st: lambda r: r.fulfill(status=200,content_type='image/png',body=open(os.path.join(TL,fn),'rb').read()) if st==200 else r.fulfill(status=404,body='nope'))(fn,st))
        return c
    STRIP_JS="""()=>{const s=document.getElementById('idstrip');const q=s.getBoundingClientRect();const imgs=[...s.querySelectorAll('img')].map(i=>{const r=i.getBoundingClientRect();return {h:r.height,w:r.width,nw:i.naturalWidth,nh:i.naturalHeight,alt:i.alt,wa:i.getAttribute('width'),ha:i.getAttribute('height')}});return {hidden:s.hidden,top:q.top,h:q.height,w:q.width,imgs,txt:s.innerText.replace(/\\s+/g,' '),divs:s.querySelectorAll('.id-div').length,sw:document.documentElement.scrollWidth,iw:innerWidth}}"""
    for (w,h) in ((360,740),(412,915),(320,568)):
        for theme in ('light','night'):
            ctx=strip_ctx(w,h); pg=ctx.new_page(); errs=[]; watch(pg,errs); goto(pg,'',700)
            if theme=='night': pg.click('#theme-btn'); pg.wait_for_timeout(200)
            m=pg.evaluate(STRIP_JS)
            ratios=[abs((i['w']/i['h'])-(i['nw']/i['nh']))/(i['nw']/i['nh']) for i in m['imgs']] or [9]
            ok('TEST-FIXTURE logos %dx%d %s: strip visible with caption + both names + 2 dividers'%(w,h,theme),not m['hidden'] and m['h']>40 and 'A joint initiative by' in m['txt'] and 'West Bengal Police' in m['txt'] and 'Siliguri Metropolitan Police' in m['txt'] and m['divs']==2,m)
            ok('TEST-FIXTURE logos %dx%d %s: each logo <=44px tall, >=28px, aspect ratio preserved (<1%% error), width <=30%% of strip, alt text, width/height attrs'%(w,h,theme),len(m['imgs'])==2 and all(28<=i['h']<=44.6 and i['w']<=0.31*m['w'] for i in m['imgs']) and max(ratios)<0.01 and [i['alt'] for i in m['imgs']]==['West Bengal Police logo','Siliguri Metropolitan Police logo'] and all(i['wa'] and i['ha'] for i in m['imgs']),(m['imgs'],ratios))
            ok('TEST-FIXTURE logos %dx%d %s: no overflow, no console errors'%(w,h,theme),m['sw']<=m['iw'] and not errs,(m['sw'],m['iw'],errs))
            pg.screenshot(path=SHOTS+'v4-TEST-FIXTURE-logos-home-%dx%d-%s.png'%(w,h,theme))
            if AXE and (w,h)==(360,740):
                pg.evaluate(AXE); v=pg.evaluate("axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','best-practice']}}).then(r=>r.violations.map(v=>v.id+': '+v.nodes[0].html.slice(0,80)))")
                ok('TEST-FIXTURE logos %s: axe (incl. contrast) clean on home'%theme,not v,v)
            ctx.close()
    # robustness: flag true but files missing / one failing / switched off
    for label,kw in (('both logo files 404',dict(logo_status=(404,404))),('only one logo 404',dict(logo_status=(200,404))),('institutionalBranding.enabled=false',dict(enabled=False)),('logosPresent=false even though files exist',dict(present=False))):
        ctx=strip_ctx(360,740,**kw); pg=ctx.new_page(); errs=[]; rq=[]; watch(pg,errs); pg.on('request',lambda r: rq.append(r.url)); goto(pg,'',800)
        m=pg.evaluate(STRIP_JS); ok('strip hidden with no gap: %s'%label,m['hidden'] and m['h']==0 and m['sw']<=m['iw'],m)
        if label.startswith('institutional') or label.startswith('logosPresent'): ok('strip off => logo files are never requested (%s)'%label,not [u for u in rq if 'assets/logos' in u],rq)
        ctx.close()
    # --- responsive cards: columns vs stacked
    COLS_JS="(()=>{const a=[...document.querySelectorAll('.bigrow .bigbtn')].map(x=>x.getBoundingClientRect());return {two:Math.abs(a[0].top-a[1].top)<2,w:a.map(x=>Math.round(x.width)),prim:Math.round(document.querySelector('.bigbtn-primary').getBoundingClientRect().width),clip:[...document.querySelectorAll('.bigbtn')].some(x=>x.scrollWidth>x.clientWidth+1),sw:document.documentElement.scrollWidth,iw:innerWidth}})()"
    def cols(pg): return pg.evaluate(COLS_JS)
    for w,h,exp in ((320,568,False),(360,740,True),(375,812,True),(412,915,True),(768,1024,True),(1280,800,True)):
        ctx=new_ctx(mobile=(w<700),viewport={'width':w,'height':h}); pg=ctx.new_page(); goto(pg,'',500); m=cols(pg)
        ok('cards at %d px: secondary cards %s, none clipped, no overflow'%(w,'side by side' if exp else 'stacked'),m['two']==exp and not m['clip'] and m['sw']<=m['iw'],m)
        if w in(320,360): ok('cards at %d px: primary card spans the full content width'%w,m['prim']>=w-30,m)
        ctx.close()
    for w in (320,390):
        ctx=new_ctx(viewport={'width':w,'height':800}); pg=ctx.new_page(); goto(pg,'',400)
        pg.evaluate("document.documentElement.style.fontSize='32px'"); pg.wait_for_timeout(250)
        bad_r=[]
        for r in ('','find','parking','traffic','help','info'):
            go(pg,r,250); o=pg.evaluate("({sw:document.documentElement.scrollWidth,iw:innerWidth})")
            if o['sw']>o['iw']: bad_r.append((r,o))
        go(pg,'',250); m=cols(pg)
        ok('200%% text size at %d px: secondary cards stack (no shrinking fonts), no clipping'%w,m['two'] is False and not m['clip'],m)
        ok('200%% text size at %d px: no horizontal overflow on any screen'%w,not bad_r,bad_r)
        pg.screenshot(path=SHOTS+'v4-home-%dpx-200pct-text.png'%w); ctx.close()
    # --- extra widths overflow (768/1280) on all screens, light + night
    for (w,h) in ((768,1024),(1280,800)):
        for theme in ('light','night'):
            ctx=new_ctx(mobile=False,viewport={'width':w,'height':h}); pg=ctx.new_page(); goto(pg,'',400)
            if theme=='night': pg.click('#theme-btn'); pg.wait_for_timeout(150)
            bad_r=[]
            for r in ('','find/demo-pandal-a','parking','traffic','help','info'):
                go(pg,r,300); o=pg.evaluate("({sw:document.documentElement.scrollWidth,iw:innerWidth})")
                if o['sw']>o['iw']: bad_r.append((r,o))
            ok('overflow: none at %d px %s on all screens'%(w,theme),not bad_r,bad_r)
            if w==768: go(pg,'',200); pg.screenshot(path=SHOTS+'v4-home-768-%s.png'%theme)
            ctx.close()
    # --- required screenshots (360x740, 412x915, 320x568; light + night), no logo files in the repo => strip hidden
    for (w,h) in ((360,740),(412,915),(320,568)):
        for theme in ('light','night'):
            ctx=new_ctx(viewport={'width':w,'height':h}); pg=ctx.new_page(); goto(pg,'',700)
            if theme=='night': pg.click('#theme-btn'); pg.wait_for_timeout(150)
            pg.screenshot(path=SHOTS+'v4-home-%dx%d-%s.png'%(w,h,theme))
            pg.screenshot(path=SHOTS+'v4-home-full-%dx%d-%s.png'%(w,h,theme),full_page=True)
            for r in ('find','traffic','parking'):
                go(pg,r,300); pg.screenshot(path=SHOTS+'v4-%s-%dx%d-%s.png'%(r,w,h,theme))
            ctx.close()
    # --- service worker installs when optional logos are flagged but missing (temp copy of the site, removed afterwards)
    if os.path.basename(ROOT)=='siliguri-puja-navigator' and BASE.endswith('/siliguri-puja-navigator/'):
        tmpsite=os.path.join(os.path.dirname(ROOT),'spn-swtest-tmp')
        shutil.rmtree(tmpsite,ignore_errors=True)
        try:
            shutil.copytree(ROOT,tmpsite,ignore=shutil.ignore_patterns('.git','tests','node_modules'))
            os.makedirs(os.path.join(tmpsite,'assets','logos'),exist_ok=True)
            for n,f in (('west-bengal-police.png','a.png'),('siliguri-metropolitan-police.png','b.png')): shutil.copy(os.path.join(TL,f),os.path.join(tmpsite,'assets','logos',n))
            subprocess.run(['node',os.path.join(ROOT,'tools','build-sw.js')],env=dict(os.environ,SPN_ROOT=tmpsite),check=True,capture_output=True)
            swtxt=open(os.path.join(tmpsite,'service-worker.js')).read()
            for n in ('west-bengal-police.png','siliguri-metropolitan-police.png'): os.remove(os.path.join(tmpsite,'assets','logos',n))   # now: flagged present, files missing
            ok('sw test site: ASSETS lists both logos and branding says present (so install must tolerate their absence)','assets/logos/west-bengal-police.png' in swtxt and 'logosPresent: true' in open(os.path.join(tmpsite,'branding.js')).read())
            ctx=new_ctx(sw='allow'); pg=ctx.new_page(); errs=[]; watch(pg,errs)
            pg.goto(ORIGIN+'/spn-swtest-tmp/index.html'); pg.wait_for_timeout(500)
            st=pg.evaluate("navigator.serviceWorker.ready.then(r=>r.active.state)"); pg.wait_for_timeout(800)
            n=pg.evaluate("caches.keys().then(async k=>{const o={};for(const x of k){o[x]=(await (await caches.open(x)).keys()).map(r=>new URL(r.url).pathname.split('/').slice(-1)[0])}return o})")
            shell=[v for k,v in n.items() if k.startswith('spn-shell-')]
            ok('SW installs and activates when optional logo files are missing (core files cached, logos skipped)',st=='activated' and shell and 'index.html' in shell[0] and 'app.js' in shell[0] and 'west-bengal-police.png' not in shell[0],(st,n))
            ok('app still loads and the strip stays hidden (no gap) when flagged logos are missing',pg.evaluate("document.getElementById('idstrip').hidden") and pg.evaluate("document.querySelector('h1').textContent.replace(/\\s+/g,' ').trim()")=='Siliguri Puja Guide')
            ctx.close()
        finally:
            shutil.rmtree(tmpsite,ignore_errors=True)
    else:
        print('SKIP sw-missing-logos test (site not served from sibling dir)')
    shutil.rmtree(TL,ignore_errors=True)
    b.close()
bad=[r for r in results if not r[1]]
print('\n%d checks, %d failed'%(len(results),len(bad)))
sys.exit(1 if bad else 0)

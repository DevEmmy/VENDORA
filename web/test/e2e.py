"""End-to-end test of the Vendora web app (mock Wema, no server).
Usage: python3 test/e2e.py http://localhost:4173
Covers: onboarding, sample shop, sell by tap (cash, credit, transfer), stock steppers, add item,
Vendors Hub order + delivery, Wema loan, receipt check (typed, duplicate, fake), debts, assistant
send button + undo, records integrity + tamper detection, staff PIN, no dev settings visible."""
import sys, os, re
from playwright.sync_api import sync_playwright, expect

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:4173'
SHOTS = os.path.join(os.path.dirname(__file__), 'shots')
os.makedirs(SHOTS, exist_ok=True)
errors = []
step_no = [0]

def shot(page, name):
    step_no[0] += 1
    page.screenshot(path=os.path.join(SHOTS, f'{step_no[0]:02d}-{name}.png'))

def nav(page, label):
    page.locator('nav.nav').get_by_role('button', name=label, exact=True).click()

def main():
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'])
        ctx = b.new_context(viewport={'width': 400, 'height': 860}, device_scale_factor=2, accept_downloads=True,
                            permissions=['geolocation', 'microphone', 'camera'], geolocation={'latitude': 6.4601, 'longitude': 3.1955, 'accuracy': 8})
        page = ctx.new_page()
        page.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
        page.on('console', lambda m: m.type == 'error' and errors.append(f'console: {m.text}'))
        page.goto(URL)
        page.evaluate('localStorage.clear()')
        page.reload()

        # ---- onboarding (real path) ----
        expect(page.get_by_text('Talk to your shop')).to_be_visible()
        shot(page, 'welcome')
        page.get_by_role('button', name='Set up my shop').click()
        page.get_by_placeholder('e.g. Ngozi Okafor').fill('Adaeze Nwosu')
        page.get_by_placeholder('0803 000 0000').fill('08051234567')
        page.get_by_placeholder('e.g. Ngozi Provisions').fill('Ada Foods')
        page.get_by_role('button', name='Foodstuff').click()
        page.get_by_role('button', name='Continue').click()
        # step 2: permissions, one tap each
        expect(page.get_by_text('Allow Vendora')).to_be_visible()
        page.get_by_role('button', name=re.compile('Allow microphone|Allowed. Test again')).first.click()
        expect(page.get_by_text('Microphone allowed')).to_be_visible(timeout=8000)
        page.get_by_role('button', name='Use my precise location').click()
        expect(page.get_by_text('Accurate to 8 m', exact=True)).to_be_visible(timeout=15000)
        shot(page, 'permissions')
        page.get_by_role('button', name='Continue').click()
        page.get_by_placeholder('11 digits').fill('12345678901')
        page.get_by_role('button', name='Open my Wema account').click()
        expect(page.get_by_text('Account ready')).to_be_visible(timeout=5000)
        shot(page, 'account-ready')
        page.get_by_role('button', name=re.compile('Start selling')).click()
        expect(page.get_by_text('What do you want to do?')).to_be_visible()
        body = page.inner_text('body')
        for bad in ['API key', 'Server URL', 'Confidential', 'CONFIDENTIAL', 'Demo mode']:
            assert bad not in body, f'dev text visible: {bad}'

        # fresh shop: add stock with steppers only
        page.locator('.action', has_text='My stock').click()
        rows = page.locator('.stock-row')
        expect(rows.first).to_be_visible()
        assert rows.count() == 6, rows.count()
        page.get_by_role('button', name='One more Rice (bag)').click()
        page.get_by_role('button', name='One more Rice (bag)').click()
        page.get_by_role('button', name='One more Indomie').click()
        expect(page.locator('.savebar')).to_contain_text('3 items arriving')
        shot(page, 'stock-steppers')
        page.locator('.savebar').get_by_role('button', name='Save').click()
        expect(page.locator('.stock-row', has_text='Rice (bag)')).to_contain_text('2 bags')

        # add a brand-new item from the common list
        page.get_by_role('button', name='Add a new item').click()
        page.locator('.sheet').get_by_role('button', name='Sugar (bag)').click()
        page.locator('.sheet label', has_text='You buy at').locator('input').fill('17000')
        page.locator('.sheet label', has_text='You sell at').locator('input').fill('19000')
        page.locator('.sheet').get_by_role('button', name='One more').first.click()
        shot(page, 'add-item')
        page.locator('.sheet').get_by_role('button', name='Add item').click()
        expect(page.locator('.stock-row', has_text='Sugar (bag)')).to_be_visible()

        # sell by tapping, cash
        nav(page, 'Sell')
        page.get_by_label('Find an item to sell').fill('ric')
        page.get_by_label('Find an item to sell').press('Enter')
        assert page.locator('.tile').count() == 1, page.locator('.tile').count()
        page.get_by_label('Find an item to sell').fill('zzz')
        expect(page.get_by_text('No item called "zzz"')).to_be_visible()
        page.get_by_role('button', name='Clear search').click()
        assert page.locator('.tile').count() >= 6
        page.get_by_role('button', name='Add Rice (bag)').click()
        expect(page.locator('.cartbar')).to_contain_text('1 item')
        page.get_by_role('button', name='Charge').click()
        page.locator('.sheet').get_by_role('button', name=re.compile('Cash received')).click()
        expect(page.get_by_text('Sale recorded')).to_be_visible()
        page.get_by_role('button', name='View invoice INV-00001').click()
        expect(page.locator('.sheet')).to_contain_text('Invoice INV-00001')
        expect(page.locator('.sheet')).to_contain_text('Ada Foods')
        shot(page, 'invoice')
        page.keyboard.press('Escape')
        page.get_by_role('button', name='Go back').click()
        nav(page, 'Sell')

        # credit sale -> debt appears
        page.get_by_role('button', name='Add Rice (bag)').click()
        page.get_by_role('button', name='Charge').click()
        page.locator('.sheet').get_by_role('button', name='Owe me').click()
        page.get_by_placeholder('Or type a name').fill('Mama Tunde')
        page.locator('.sheet').get_by_role('button', name=re.compile('owed')).click()
        expect(page.get_by_text('Mama Tunde owes')).to_be_visible()
        page.get_by_role('button', name='Next sale').click()
        nav(page, 'Home')
        page.locator('.action', has_text='Debts').click()
        expect(page.get_by_text('Customers owe you')).to_be_visible()
        page.locator('.item', has_text='Mama Tunde').click()
        page.locator('.sheet').get_by_role('button', name=re.compile('^All,')).click()
        page.keyboard.press('Escape')
        expect(page.locator('.item', has_text='Mama Tunde')).to_contain_text('No debt')
        shot(page, 'debts')

        # assistant: send button works, undo works
        page.locator('nav.nav').get_by_role('button', name='Talk to Vendora').click()
        expect(page.locator('h1', has_text='Talk to Vendora')).to_be_visible()
        page.wait_for_timeout(800)
        if page.get_by_role('button', name='Stop listening').count(): page.get_by_role('button', name='Stop listening').click()
        page.get_by_label('Message').wait_for(timeout=10000)
        page.get_by_label('Message').fill('I sold 1 indomie')
        page.get_by_role('button', name='Send', exact=True).click()
        expect(page.locator('.bubble.bot.done')).to_be_visible()
        shot(page, 'assistant')
        page.locator('.bubble.bot.done').get_by_role('button', name='Undo').click()
        expect(page.get_by_text('Undone, kept in records')).to_be_visible()
        page.get_by_label('Message').fill('how much did i sell today')
        page.get_by_label('Message').press('Enter')
        expect(page.locator('.bubble.bot').last).to_contain_text('₦')
        page.get_by_role('button', name='Go back').click()

        # ---- sample shop for the money features ----
        page.evaluate('localStorage.clear()')
        page.reload()
        page.get_by_role('button', name='Explore a sample shop').click()
        expect(page.get_by_text('What do you want to do?')).to_be_visible()
        shot(page, 'home')
        page.mouse.wheel(0, 900); page.wait_for_timeout(200); shot(page, 'home-scrolled')

        # receipt check: typed, real credit -> confirmed; reuse -> blocked; fake -> not arrived
        page.locator('.action', has_text='Check a receipt').click()
        page.get_by_role('tab', name='Type details').click()
        page.locator('label', has_text='Amount').locator('input').fill('5000')
        page.locator('label', has_text="Sender's name").locator('input').fill('Chidi Obi')
        page.locator('label', has_text='Reference').locator('input').fill('100004251011193022184937265101')
        shot(page, 'receipt-type')
        page.get_by_role('button', name='Check with Wema').click()
        expect(page.get_by_text('Money confirmed')).to_be_visible(timeout=5000)
        shot(page, 'receipt-confirmed')
        # what was it for? -> debt
        expect(page.locator('.sheet')).to_contain_text('₦5,000 received')
        page.locator('.sheet .item', has_text='Mama Chidi').click()
        page.get_by_role('button', name='New check').click()
        page.get_by_role('tab', name='Type details').click()
        page.locator('label', has_text='Amount').locator('input').fill('5000')
        page.locator('label', has_text='Reference').locator('input').fill('100004251011193022184937265101')
        page.get_by_role('button', name='Check with Wema').click()
        expect(page.get_by_text('Receipt already used')).to_be_visible(timeout=5000)
        page.get_by_role('button', name='New check').click()
        page.get_by_role('tab', name='Type details').click()
        page.locator('label', has_text='Amount').locator('input').fill('45000')
        page.locator('label', has_text="Sender's name").locator('input').fill('Fake Alert')
        page.get_by_role('button', name='Check with Wema').click()
        expect(page.get_by_text('Money has NOT arrived')).to_be_visible(timeout=5000)
        shot(page, 'receipt-fake')
        page.get_by_role('button', name='Done').click()

        # transfer sale with one-time account -> auto confirmed
        nav(page, 'Sell')
        shot(page, 'sell')
        page.get_by_role('button', name='Add Yellow Garri').click()
        page.get_by_role('button', name='Add Yellow Garri').click()
        page.get_by_role('button', name='Charge').click()
        page.locator('.sheet').get_by_role('button', name='Transfer').click()
        page.locator('.sheet').get_by_role('button', name='Show account to customer').click()
        expect(page.get_by_text('Ask the customer to transfer exactly')).to_be_visible(timeout=5000)
        shot(page, 'transfer-account')
        page.get_by_role('button', name='Simulate the customer paying').click()
        expect(page.get_by_text('Payment received')).to_be_visible(timeout=5000)
        page.locator('.sheet').get_by_role('button', name='Done').click()

        # Vendors Hub: confirm arriving order, open seller, order
        nav(page, 'Hub')
        expect(page.get_by_text('On the way from Emeka Brothers')).to_be_visible()
        shot(page, 'hub')
        hs = page.get_by_label('Search the Vendors Hub')
        hs.fill('rice')
        page.get_by_role('button', name='Search', exact=True).click()
        expect(page.get_by_text(re.compile(r'\d+ offers for "rice"'))).to_be_visible()
        shot(page, 'hub-search')
        hs.fill('mile 12')
        expect(page.locator('button.card', has_text='Bimbo Wholesale')).to_be_visible()
        hs.fill('qwerty')
        expect(page.get_by_text('No seller has "qwerty" yet')).to_be_visible()
        page.get_by_role('button', name='Clear search').click()
        expect(page.get_by_text('All verified sellers')).to_be_visible()
        page.get_by_role('button', name='I have received it').click()
        expect(page.get_by_text('On the way from Emeka Brothers')).to_have_count(0)
        page.locator('button.card', has_text='Bimbo Wholesale').first.click()
        expect(page.get_by_text('Wema-verified business account')).to_be_visible()
        page.get_by_role('button', name=re.compile('More Tomato')).click()
        shot(page, 'seller')
        page.get_by_role('button', name='Order', exact=True).click()
        page.get_by_role('button', name=re.compile('Pay with Wema Restock Loan')).click()

        # Wema loan
        expect(page.get_by_text('Your limit')).to_be_visible(timeout=5000)
        page.get_by_role('button', name=re.compile(r'Get ₦')).wait_for()
        shot(page, 'loan')
        page.get_by_role('button', name=re.compile(r'Get ₦')).click()
        expect(page.get_by_text('Loan approved')).to_be_visible(timeout=5000)
        page.get_by_role('button', name='See my loan').click()
        expect(page.get_by_text('Left to pay')).to_be_visible()
        shot(page, 'wallet-loan')
        page.get_by_role('button', name=re.compile(r'^Pay ₦')).click()
        expect(page.get_by_text('repaid to Wema')).to_be_visible(timeout=5000)

        # records + score
        nav(page, 'Home')
        page.get_by_role('button', name='Records secured').click()
        expect(page.get_by_text('All records intact')).to_be_visible()
        shot(page, 'records')
        page.get_by_role('button', name='Go back').click()

        page.get_by_role('button', name=re.compile('Sales today')).click()
        expect(page.get_by_text('Best sellers')).to_be_visible()
        shot(page, 'insights')
        page.get_by_role('button', name='Go back').click()
        # advert with a photo
        from PIL import Image as _I
        img = os.path.join(SHOTS, '_shop.jpg'); _I.new('RGB', (900, 600), (240, 180, 40)).save(img)
        nav(page, 'Hub')
        page.get_by_role('button', name=re.compile('Advertise your shop here')).click()
        page.locator('input[type=file][multiple]').set_input_files(img)
        expect(page.locator('.thumb img')).to_have_count(1, timeout=8000)
        page.get_by_placeholder('e.g. Rice, oil and provisions at wholesale prices').fill('Rice, milk and oil at Alaba prices')
        shot(page, 'advert')
        page.get_by_role('button', name='Publish my advert').click()
        expect(page.get_by_text('Your advert', exact=True)).to_be_visible()
        os.remove(img)

        # CAC: finish saving, send form
        nav(page, 'Home')
        page.locator('.action', has_text='Get CAC').click()
        expect(page.get_by_text('Finish faster')).to_be_visible()
        shot(page, 'cac-saving')
        page.get_by_role('button', name=re.compile('^All ₦')).click()
        expect(page.get_by_text('is complete')).to_be_visible()
        page.get_by_label('I allow Wema to file').check() if page.get_by_label('I allow Wema to file').count() else page.locator('input[type=checkbox]').check()
        page.get_by_role('button', name='Send to Wema for registration').click()
        expect(page.get_by_text('Wema is filing your registration', exact=True)).to_be_visible()
        page.get_by_role('button', name='Go back').click()

        # records to Wema: Excel download + submit
        page.locator('.action', has_text='Send records to Wema').click()
        with page.expect_download() as dl:
            page.get_by_role('button', name='Download Excel file').click()
        path = dl.value.path()
        assert dl.value.suggested_filename.endswith('.xlsx'), dl.value.suggested_filename
        import zipfile; assert 'xl/workbook.xml' in zipfile.ZipFile(path).namelist()
        page.get_by_role('button', name='Submit to Wema').click()
        expect(page.get_by_text('Sent to Wema', exact=True)).to_be_visible(timeout=8000)
        shot(page, 'send-to-wema')
        page.get_by_role('button', name='Go back').click()

        # staff PIN switch
        page.get_by_label('Your profile and settings').click()
        body = page.inner_text('body')
        for bad in ['API key', 'Server URL', 'Confidential', 'CONFIDENTIAL']:
            assert bad not in body, f'dev text visible: {bad}'
        shot(page, 'profile')
        page.locator('.item', has_text='Vendora on WhatsApp').click()
        page.get_by_label('WhatsApp message').fill('sold 2 garri')
        page.get_by_label('WhatsApp message').press('Enter')
        expect(page.locator('.wa-b.me')).to_contain_text('sold 2 garri')
        shot(page, 'whatsapp')
        page.get_by_role('button', name='Go back').click()
        page.locator('.item', has_text='Business Score').click()
        expect(page.get_by_text('What makes your score')).to_be_visible()
        shot(page, 'score')
        page.get_by_role('button', name='Go back').click()
        page.locator('.item', has_text='Premium').click()
        expect(page.get_by_text('Vendora Premium')).to_be_visible()
        page.get_by_role('button', name='Go back').click()
        page.locator('.item', has_text='Permissions').click()
        expect(page.get_by_text('Shop location')).to_be_visible()
        page.get_by_role('button', name='Go back').click()
        page.locator('.item', has_text='Shop assistants').click()
        page.get_by_role('button', name='Hand phone to an assistant').click()
        for d in '1234': page.locator('.pinpad').get_by_role('button', name=d, exact=True).click()
        expect(page.get_by_text('What do you want to do?')).to_be_visible()
        assert page.locator('.action', has_text='Wema loan').count() == 0, 'assistant sees loans'

        # tamper: edit an old sale amount in storage -> app must notice and block loans
        page.wait_for_timeout(500)
        page.goto(URL.rstrip('/') + '/manifest.webmanifest')  # same origin, app not running, so it can't re-save
        page.evaluate("""() => { const s = JSON.parse(localStorage.getItem('vendora:v2')); const t = s.txns.find(x => x.type === 'sale' && x.amount > 1000); t.amount = t.amount * 10; localStorage.setItem('vendora:v2', JSON.stringify(s)); }""")
        page.goto(URL)
        expect(page.get_by_text('Records need attention')).to_be_visible()
        shot(page, 'tampered')

        b.close()
    real = [e for e in errors if 'favicon' not in e and 'speech' not in e.lower()]
    if real:
        print('ERRORS:\n' + '\n'.join(real)); sys.exit(1)
    print(f'E2E PASSED, {step_no[0]} screenshots in {SHOTS}')

main()

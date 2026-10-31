"""Seed a throwaway Orbit API (port 8100) with finance data for screenshots.

Run against a fresh scratch database: python3 -I seed.py > session.json
"""

import json
import sys
import urllib.error
import urllib.request
from datetime import date, timedelta

API = "http://localhost:8100/api/v1"
TOKEN = None


def call(method, path, body=None, ok_fail=False):
    req = urllib.request.Request(API + path, method=method)
    req.add_header("Content-Type", "application/json")
    if TOKEN:
        req.add_header("Authorization", f"Bearer {TOKEN}")
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data) as r:
            raw = r.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        msg = e.read().decode()
        if ok_fail:
            print("WARN", method, path, e.code, msg[:300], file=sys.stderr)
            return None
        sys.exit(f"{method} {path} -> {e.code}: {msg}")


today = date.today()


def d(n):
    return (today - timedelta(days=n)).isoformat()


month_start = today.replace(day=1)


def months_ago(n, day):
    y, m = today.year, today.month - n
    while m <= 0:
        m += 12
        y -= 1
    return date(y, m, min(day, 28)).isoformat()


call(
    "POST",
    "/auth/local/sign-up",
    {"email": "preview@example.com", "password": "preview-password-123", "display_name": "Asha"},
)
signup = call(
    "POST",
    "/auth/local/sign-in",
    {"email": "preview@example.com", "password": "preview-password-123"},
)
TOKEN = signup["access_token"]
ws = call("GET", "/workspaces")
ws = ws["workspaces"][0]["id"] if isinstance(ws, dict) else ws[0]["id"]
F = f"/workspaces/{ws}/finance"

cats = (
    {c["name"]: c["id"] for c in call("GET", F + "/categories")["categories"]}
    if isinstance(call("GET", F + "/categories"), dict)
    else {c["name"]: c["id"] for c in call("GET", F + "/categories")}
)
print("categories:", list(cats)[:20], file=sys.stderr)


def cat(*names):
    for n in names:
        if n in cats:
            return cats[n]
    return None


def acct(name, type_, bal):
    body = {"name": name, "type": type_, "currency": "INR", "opening_balance": bal * 100}
    return call("POST", F + "/accounts", body)["id"]


hdfc = acct("HDFC Salary", "bank", 185000)
sbi = acct("SBI Savings", "savings", 420000)
cash = acct("Cash", "cash", 6500)
paytm = acct("Paytm Wallet", "wallet", 1200)
card = acct("ICICI Amazon Pay card", "credit_card", 0)


def tx(type_, amount, days, desc, account, category=None, to=None):
    body = {
        "type": type_,
        "amount": amount * 100,
        "occurred_on": d(days),
        "description": desc,
        "account_id": account,
        "category_id": category,
    }
    if to:
        body["to_account_id"] = to
    call("POST", F + "/transactions", body)


# Six months of salary and spending so the trend and history have shape.
for n in range(5, -1, -1):
    tx(
        "income",
        142000,
        (today - date.fromisoformat(months_ago(n, 1))).days,
        "Salary",
        hdfc,
        cat("Salary"),
    )
    base = (today - date.fromisoformat(months_ago(n, 3))).days
    for i, (amt, desc, c, a) in enumerate(
        [
            (32000, "Rent", ("Rent", "Housing"), hdfc),
            (6200 + n * 300, "BigBasket groceries", ("Groceries", "Food"), card),
            (2400 + n * 150, "Swiggy dinner", ("Food and dining",), card),
            (1800, "Uber rides", ("Transport", "Travel"), paytm),
            (3100 - n * 200, "Electricity bill", ("Utilities", "Bills"), hdfc),
            (4500 + (n % 3) * 1200, "Amazon order", ("Shopping",), card),
            (950, "Pharmacy", ("Healthcare",), cash),
        ]
    ):
        days = max(base - i * 3, 0)
        if days <= (today - month_start).days or n > 0:
            tx("expense", amt, days, desc, a, cat(*c))
tx("refund", 1200, 2, "Amazon return", card, cat("Shopping"))
tx("income", 8500, 6, "Freelance design work", sbi, cat("Freelance", "Other income", "Salary"))
tx(
    "expense",
    12999,
    4,
    "Noise-cancelling headphones with a very long description to test truncation",
    card,
    cat("Shopping"),
)
call(
    "POST",
    F + "/transfers",
    {
        "amount": 25000 * 100,
        "occurred_on": d(1),
        "description": "Card bill payment",
        "from_account_id": hdfc,
        "to_account_id": card,
    },
)

# Budgets.
call(
    "POST",
    F + "/budgets",
    {
        "name": "Monthly spending",
        "scope": "overall",
        "currency": "INR",
        "amount": 60000 * 100,
        "period": "monthly",
        "start_date": months_ago(5, 1),
    },
)
for name, c, amt, roll in [
    ("Groceries", ("Groceries", "Food"), 7000, "surplus"),
    ("Dining out", ("Food and dining",), 2000, "none"),
    ("Shopping", ("Shopping",), 10000, "full"),
    ("Transport", ("Transport", "Travel"), 2500, "none"),
]:
    cid = cat(*c)
    if cid:
        call(
            "POST",
            F + "/budgets",
            {
                "name": name,
                "scope": "category",
                "category_id": cid,
                "currency": "INR",
                "amount": amt * 100,
                "period": "monthly",
                "start_date": months_ago(3, 1),
                "rollover": roll,
            },
            ok_fail=True,
        )
call(
    "POST",
    F + "/budgets",
    {
        "name": "Diwali gifts",
        "scope": "overall",
        "currency": "INR",
        "amount": 15000 * 100,
        "period": "custom",
        "start_date": d(20),
        "end_date": (today + timedelta(days=10)).isoformat(),
    },
    ok_fail=True,
)
call(
    "PUT",
    F + f"/plan/{today.strftime('%Y-%m')}",
    {"currency": "INR", "expected_income": 150500 * 100},
)

# Goals.
for name, catg, target, saved, months in [
    ("Emergency fund", "emergency_fund", 300000, 180000, 10),
    ("Goa trip", "travel", 60000, 22000, 4),
    ("New laptop", "electronics", 120000, 118000, 2),
]:
    g = call(
        "POST",
        F + "/savings-goals",
        {
            "name": name,
            "category": catg,
            "priority": "high",
            "currency": "INR",
            "target_amount": target * 100,
            "start_date": months_ago(5, 1),
            "target_date": (today + timedelta(days=30 * months)).isoformat(),
            "account_id": sbi,
        },
    )
    call(
        "POST",
        F + f"/savings-goals/{g['id']}/contributions",
        {"type": "contribution", "mode": "allocate", "amount": saved * 100, "occurred_on": d(15)},
        ok_fail=True,
    )

# Loans.
call(
    "POST",
    F + "/loans",
    {
        "name": "Car loan",
        "lender": "HDFC Bank",
        "loan_type": "vehicle",
        "currency": "INR",
        "principal": 650000 * 100,
        "interest_rate_bps": 925,
        "start_date": months_ago(14, 5),
        "tenure_months": 60,
        "first_payment_date": months_ago(13, 5),
        "outstanding_principal": 540000 * 100,
        "next_payment_date": (today + timedelta(days=5)).isoformat(),
        "payment_account_id": hdfc,
    },
    ok_fail=True,
)
call(
    "POST",
    F + "/loans",
    {
        "name": "Education loan",
        "lender": "SBI",
        "loan_type": "education",
        "currency": "INR",
        "principal": 400000 * 100,
        "interest_rate_bps": 850,
        "start_date": months_ago(30, 10),
        "tenure_months": 84,
        "first_payment_date": months_ago(29, 10),
        "outstanding_principal": 268000 * 100,
        "next_payment_date": (today - timedelta(days=21)).isoformat(),
        "payment_account_id": sbi,
    },
    ok_fail=True,
)

# Subscriptions and bills.
for kind, name, prov, amt, freq, due in [
    ("subscription", "Netflix", "Netflix", 649, "monthly", 3),
    ("subscription", "Spotify Family", "Spotify", 179, "monthly", -2),
    ("subscription", "iCloud+ 200 GB", "Apple", 219, "monthly", 12),
    ("subscription", "Amazon Prime", "Amazon", 1499, "yearly", 140),
    ("bill", "Electricity", "BESCOM", 3000, "monthly", 6),
    ("bill", "Broadband", "ACT Fibernet", 1180, "monthly", -5),
    ("bill", "Mobile postpaid", "Airtel", 599, "monthly", 9),
    ("bill", "Society maintenance", "Prestige Society", 4200, "quarterly", 25),
]:
    call(
        "POST",
        F + "/recurring-payments",
        {
            "kind": kind,
            "name": name,
            "provider": prov,
            "amount": amt * 100,
            "currency": "INR",
            "amount_varies": name == "Electricity",
            "frequency": freq,
            "next_due_date": (today + timedelta(days=due)).isoformat(),
            "account_id": card if kind == "subscription" else hdfc,
        },
        ok_fail=True,
    )

# Investments.
zer = call(
    "POST",
    F + "/investment-accounts",
    {"kind": "brokerage", "provider": "Zerodha", "name": "Zerodha", "currency": "INR"},
)
kuv = call(
    "POST",
    F + "/investment-accounts",
    {"kind": "mutual_fund", "provider": "Kuvera", "name": "Kuvera", "currency": "INR"},
)
fd = call(
    "POST",
    F + "/investment-accounts",
    {"kind": "deposit", "provider": "SBI", "name": "SBI deposits", "currency": "INR"},
)
print("inv account:", json.dumps(zer)[:300], file=sys.stderr)


def acc_id(a):
    return a.get("account_id") or a.get("id")


for acc, kind, name, sym, qty, buy, price in [
    (zer, "stock", "Infosys", "INFY", "40", 58000, "1520.40"),
    (zer, "stock", "HDFC Bank", "HDFCBANK", "25", 39000, "1710.10"),
    (zer, "etf", "Nippon India Nifty 50 BeES", "NIFTYBEES", "300", 70000, "268.55"),
    (
        kuv,
        "mutual_fund",
        "Parag Parikh Flexi Cap Fund - Direct Growth",
        "",
        "1450.212",
        98000,
        "82.31",
    ),
    (kuv, "mutual_fund", "Axis ELSS Tax Saver", "", "820.5", 60000, "68.12"),
]:
    h = call(
        "POST",
        F + "/holdings",
        {"account_id": acc_id(acc), "kind": kind, "name": name, "symbol": sym},
        ok_fail=True,
    )
    if not h:
        continue
    call(
        "POST",
        F + "/investment-transactions",
        {
            "type": "buy",
            "trade_date": months_ago(4, 12),
            "amount": buy * 100,
            "quantity": qty,
            "holding_id": h["id"],
            "settlement": "account",
            "cash_account_id": sbi,
        },
        ok_fail=True,
    )
    call(
        "POST",
        F + f"/holdings/{h['id']}/prices",
        {"price_date": d(3), "price": price},
        ok_fail=True,
    )
    if kind == "mutual_fund":
        call(
            "POST",
            F + "/sip-plans",
            {
                "holding_id": h["id"],
                "amount": 5000 * 100,
                "frequency": "monthly",
                "next_due_date": (today + timedelta(days=5)).isoformat(),
                "funding_account_id": hdfc,
            },
            ok_fail=True,
        )
call(
    "POST",
    F + "/deposits",
    {
        "account_id": acc_id(fd),
        "kind": "fixed",
        "name": "FD 2 years",
        "institution": "SBI",
        "interest_rate_bps": 710,
        "start_date": months_ago(8, 1),
        "maturity_date": (today + timedelta(days=480)).isoformat(),
        "amount": 200000 * 100,
        "settlement": "account",
        "cash_account_id": sbi,
    },
    ok_fail=True,
)
call(
    "POST",
    F + "/deposits",
    {
        "account_id": acc_id(fd),
        "kind": "recurring",
        "name": "RD monthly",
        "institution": "SBI",
        "interest_rate_bps": 650,
        "start_date": months_ago(6, 1),
        "maturity_date": (today + timedelta(days=550)).isoformat(),
        "amount": 5000 * 100,
        "settlement": "none",
    },
    ok_fail=True,
)

# Other assets.
for name, catg, cost, value, valued in [
    ("Gold jewellery", "gold", 240000, 410000, 20),
    ("Honda City 2021", "vehicle", 1150000, 780000, 400),
    ("Plot in Mysuru", "property", 1800000, None, None),
]:
    call(
        "POST",
        F + "/assets",
        {
            "name": name,
            "category": catg,
            "currency": "INR",
            "purchase_date": months_ago(30, 1),
            "purchase_cost": cost * 100,
            "current_value": value * 100 if value else None,
            "valued_on": d(valued) if valued else None,
        },
        ok_fail=True,
    )

# Net-worth snapshots for earlier months.
for n in range(5, 0, -1):
    call(
        "POST",
        F + "/net-worth/snapshots",
        {"currency": "INR", "month": months_ago(n, 1)[:7]},
        ok_fail=True,
    )
call("POST", F + "/net-worth/snapshots", {"currency": "INR"}, ok_fail=True)

print(json.dumps({"token": TOKEN, "expiresAt": signup.get("expires_at")}))

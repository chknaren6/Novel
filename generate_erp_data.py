"""
CommitOS — Synthetic ERP Data Generator
Generates SAP-field-accurate CSVs for all six agent domains.
Uses real SAP table/field naming conventions throughout.
"""

import csv
import random
import uuid
from datetime import datetime, timedelta

random.seed(42)

# ── helpers ──────────────────────────────────────────────────────────────────

def rand_date(start_days_ago=365, end_days_ago=0):
    delta = random.randint(end_days_ago, start_days_ago)
    return (datetime.today() - timedelta(days=delta)).strftime("%Y-%m-%d")

def write_csv(filename, rows, fieldnames):
    with open(filename, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    print(f"  ✓  {filename}  ({len(rows)} rows)")

# ── 1. MARA — General Material Data (product catalog) ────────────────────────

ELECTRONICS_PRODUCTS = [
    ("Schneider Electric MCB 32A",       "ELEC-SWITCH",  "EA",  4200),
    ("Havells 4-Core Copper Cable 10mm",  "ELEC-CABLE",   "MTR", 285),
    ("Siemens MCCB 100A 3P",             "ELEC-SWITCH",  "EA",  8750),
    ("Legrand Industrial Socket 32A",    "ELEC-SOCKET",  "EA",  1850),
    ("ABB Soft Starter 15kW",            "ELEC-CTRL",    "EA",  32000),
    ("Polycab 6mm FR PVC Cable",         "ELEC-CABLE",   "MTR", 118),
    ("L&T Power Contactor 40A",          "ELEC-CTRL",    "EA",  2100),
    ("Crompton 3-Phase Motor 5HP",       "ELEC-MOTOR",   "EA",  18500),
    ("Finolex 2.5mm FRLS Cable",         "ELEC-CABLE",   "MTR", 62),
    ("Eaton UPS 10kVA Online",           "ELEC-UPS",     "EA",  145000),
    ("Phoenix Contact Terminal Block",   "ELEC-CONN",    "EA",  320),
    ("Rittal IP55 Enclosure 600x400",    "ELEC-ENC",     "EA",  12400),
    ("Omron PLC CP1E 20I/O",             "ELEC-PLC",     "EA",  28000),
    ("Fluke 87V Digital Multimeter",     "ELEC-TEST",    "EA",  22000),
    ("Patlite Signal Tower LED 3-Stack", "ELEC-IND",     "EA",  4800),
    ("Rockwell VFD 7.5kW 415V",         "ELEC-CTRL",    "EA",  41000),
    ("Wago 2-Wire Connector 2.5mm",     "ELEC-CONN",    "EA",  28),
    ("Honeywell Pressure Transmitter",   "ELEC-SENSOR",  "EA",  9200),
    ("Endress+Hauser Flow Meter DN50",   "ELEC-SENSOR",  "EA",  68000),
    ("Pepperl+Fuchs Proximity Sensor",   "ELEC-SENSOR",  "EA",  3400),
]

PLANTS    = ["PL01", "PL02", "PL03"]
WAREHOUSES = ["WH-MUM", "WH-DEL", "WH-BLR"]

def gen_mara():
    rows = []
    for i, (desc, grp, uom, price) in enumerate(ELECTRONICS_PRODUCTS):
        rows.append({
            "MATNR":  f"MAT-{10001 + i}",
            "MAKTX":  desc,
            "MTART":  "HAWA",          # trading goods
            "MBRSH":  "E",             # electronics industry
            "MATKL":  grp,
            "MEINS":  uom,
            "NETPR":  price,           # list price INR
            "MSTAE":  "A",             # material status: active
            "ERSDA":  rand_date(1800, 365),
        })
    return rows

MARA_FIELDS = ["MATNR","MAKTX","MTART","MBRSH","MATKL","MEINS","NETPR","MSTAE","ERSDA"]

# ── 2. MARD — Storage Location Stock Data ────────────────────────────────────

def gen_mard(mara_rows):
    rows = []
    for mat in mara_rows:
        for plant, wh in zip(PLANTS, WAREHOUSES):
            total     = random.randint(50, 500)
            reserved  = random.randint(5, int(total * 0.4))
            available = total - reserved
            rows.append({
                "MATNR":  mat["MATNR"],
                "WERKS":  plant,
                "LGORT":  wh,
                "LABST":  available,   # unrestricted (available-to-promise)
                "RETME":  reserved,    # reserved / committed stock
                "EINME":  total,       # total stock
                "INSME":  random.randint(0, 10),  # in quality inspection
                "UMLME":  0,           # stock in transfer
                "LAEDT":  rand_date(30, 0),
            })
    return rows

MARD_FIELDS = ["MATNR","WERKS","LGORT","LABST","RETME","EINME","INSME","UMLME","LAEDT"]

# ── 3. VBAK+VBAP — Open Sales Orders (backlog) ───────────────────────────────

CUSTOMERS = [f"CUST-{1000 + i}" for i in range(15)]
ORDER_STATUSES = ["A","B","C"]   # A=open, B=partial, C=complete

def gen_open_orders(mara_rows):
    rows = []
    for _ in range(60):
        mat   = random.choice(mara_rows)
        qty   = random.randint(5, 80)
        rows.append({
            "VBELN":    f"SO-{random.randint(100000,999999)}",
            "AUART":    "OR",          # standard order
            "KUNNR":    random.choice(CUSTOMERS),
            "MATNR":    mat["MATNR"],
            "KWMENG":   qty,
            "NETWR":    round(qty * mat["NETPR"] * random.uniform(0.85, 1.0), 2),
            "WADAT":    (datetime.today() + timedelta(days=random.randint(1, 90))).strftime("%Y-%m-%d"),
            "WERKS":    random.choice(PLANTS),
            "GBSTA":    random.choice(ORDER_STATUSES),
            "ERDAT":    rand_date(180, 30),
        })
    return rows

VBAK_FIELDS = ["VBELN","AUART","KUNNR","MATNR","KWMENG","NETWR","WADAT","WERKS","GBSTA","ERDAT"]

# ── 4. KNKK — Customer Credit Master ─────────────────────────────────────────

RISK_CATEGORIES = {
    "001": "LOW",
    "002": "MEDIUM",
    "003": "HIGH",
}
PAYMENT_TERMS = ["NET30", "NET45", "NET60", "ADVANCE", "LC"]

def gen_knkk():
    rows = []
    for cust in CUSTOMERS:
        risk_code  = random.choices(["001","002","003"], weights=[50,35,15])[0]
        credit_lim = random.choice([500000, 1000000, 2000000, 5000000, 10000000])
        utilized   = round(credit_lim * random.uniform(0.3, 0.9), 2)
        rows.append({
            "KUNNR":    cust,
            "NAME1":    f"Customer {cust}",
            "KKBER":    "CC01",        # credit control area
            "KLIMK":    credit_lim,    # credit limit INR
            "SKFOR":    utilized,      # current exposure
            "CTLPC":    risk_code,     # risk category code
            "CTLPC_DESC": RISK_CATEGORIES[risk_code],
            "CRBLB":    "X" if utilized > credit_lim * 0.95 else "",  # blocked flag
            "CASHD":    rand_date(120, 5),   # last payment date
            "ZTERM":    random.choice(PAYMENT_TERMS),
            "GRUPP":    f"CG{random.randint(1,3):02d}",  # credit group
            "WAERS":    "INR",
        })
    return rows

KNKK_FIELDS = ["KUNNR","NAME1","KKBER","KLIMK","SKFOR","CTLPC","CTLPC_DESC",
                "CRBLB","CASHD","ZTERM","GRUPP","WAERS"]

# ── 5. MBEW — Material Valuation (margin rules) ───────────────────────────────

def gen_mbew(mara_rows):
    rows = []
    for mat in mara_rows:
        list_price  = mat["NETPR"]
        cost        = round(list_price * random.uniform(0.55, 0.72), 2)
        floor_margin = round(random.uniform(0.12, 0.22), 4)   # 12-22%
        floor_price  = round(cost / (1 - floor_margin), 2)
        rows.append({
            "MATNR":        mat["MATNR"],
            "WERKS":        random.choice(PLANTS),
            "STPRS":        cost,          # standard price (cost)
            "VERPR":        round(cost * random.uniform(0.98, 1.02), 2),  # moving avg
            "PEINH":        1,             # price unit
            "WAERS":        "INR",
            "FLOOR_MARGIN": floor_margin,  # CommitOS custom: floor margin %
            "FLOOR_PRICE":  floor_price,   # minimum acceptable selling price
            "LAEDT":        rand_date(90, 0),
        })
    return rows

MBEW_FIELDS = ["MATNR","WERKS","STPRS","VERPR","PEINH","WAERS",
               "FLOOR_MARGIN","FLOOR_PRICE","LAEDT"]

# ── 6. LFA1+EINE — Vendor/Supplier Master ────────────────────────────────────

SUPPLIER_NAMES = [
    "Havells India Ltd",
    "Schneider Electric India",
    "Siemens Ltd India",
    "ABB India Limited",
    "L&T Electrical & Automation",
    "Polycab India Ltd",
    "Crompton Greaves Consumer",
    "Eaton India Pvt Ltd",
]

def gen_suppliers(mara_rows):
    rows = []
    supplier_ids = [f"VEND-{2001 + i}" for i in range(len(SUPPLIER_NAMES))]
    # each material can be supplied by 1-3 vendors
    for mat in mara_rows:
        vendors = random.sample(supplier_ids, k=random.randint(1, 3))
        for vid in vendors:
            capacity   = random.randint(100, 1000)
            booked     = random.randint(0, int(capacity * 0.8))
            rows.append({
                "LIFNR":        vid,
                "NAME1":        SUPPLIER_NAMES[supplier_ids.index(vid)],
                "MATNR":        mat["MATNR"],
                "NETPR":        round(mat["NETPR"] * random.uniform(0.55, 0.72), 2),
                "MINBM":        random.choice([5, 10, 20, 50]),   # min order qty
                "WEBAZ":        random.randint(3, 21),            # lead time days
                "EKGRP":        f"PG{random.randint(1,3):02d}",  # purchasing group
                "MONTHLY_CAP":  capacity,    # units supplier can deliver per month
                "BOOKED_CAP":   booked,      # already committed to other buyers
                "AVAIL_CAP":    capacity - booked,
                "RELIABILITY":  round(random.uniform(0.72, 0.99), 2),  # historical on-time %
                "LAND1":        "IN",        # country
                "LOEVM":        "",          # deletion flag (blank = active)
            })
    return rows

LFA1_FIELDS = ["LIFNR","NAME1","MATNR","NETPR","MINBM","WEBAZ","EKGRP",
               "MONTHLY_CAP","BOOKED_CAP","AVAIL_CAP","RELIABILITY","LAND1","LOEVM"]

# ── 7. TVRO — Routes & Logistics Slots ───────────────────────────────────────

ROUTES = [
    ("RT-MUM-DEL", "WH-MUM", "ZONE-NORTH", "BlueDart",  3, 18000),
    ("RT-MUM-BLR", "WH-MUM", "ZONE-SOUTH", "Delhivery", 2, 12000),
    ("RT-MUM-HYD", "WH-MUM", "ZONE-SOUTH", "DTDC",      2, 8000),
    ("RT-MUM-CHE", "WH-MUM", "ZONE-SOUTH", "FedEx",     3, 10000),
    ("RT-DEL-BLR", "WH-DEL", "ZONE-SOUTH", "BlueDart",  4, 15000),
    ("RT-DEL-HYD", "WH-DEL", "ZONE-SOUTH", "Delhivery", 3, 9000),
    ("RT-DEL-KOL", "WH-DEL", "ZONE-EAST",  "DTDC",      2, 7000),
    ("RT-BLR-CHE", "WH-BLR", "ZONE-SOUTH", "FedEx",     1, 11000),
    ("RT-BLR-HYD", "WH-BLR", "ZONE-SOUTH", "BlueDart",  1, 8500),
    ("RT-BLR-MUM", "WH-BLR", "ZONE-WEST",  "Delhivery", 2, 13000),
]

def gen_tvro():
    rows = []
    for route, src_wh, dest_zone, carrier, transit_days, max_kg in ROUTES:
        booked_pct  = random.uniform(0.3, 0.85)
        booked_kg   = round(max_kg * booked_pct, 0)
        avail_kg    = max_kg - booked_kg
        rows.append({
            "ROUTE":        route,
            "VSTEL":        src_wh,        # shipping point (source warehouse)
            "BZIRK":        dest_zone,     # destination sales district/zone
            "TDLNR":        carrier,       # transport service agent (carrier)
            "TRATY":        "ROAD",        # transport mode
            "TTIME":        transit_days,  # transit time in days
            "LPTIME":       1,             # loading/planning time days
            "MAX_KG":       max_kg,        # max capacity kg per shipment
            "BOOKED_KG":    booked_kg,
            "AVAIL_KG":     avail_kg,
            "NEXT_SLOT":    (datetime.today() + timedelta(days=random.randint(1, 5))).strftime("%Y-%m-%d"),
            "LAEDT":        rand_date(30, 0),
        })
    return rows

TVRO_FIELDS = ["ROUTE","VSTEL","BZIRK","TDLNR","TRATY","TTIME","LPTIME",
               "MAX_KG","BOOKED_KG","AVAIL_KG","NEXT_SLOT","LAEDT"]

# ── 8. KNKK_RISK — Risk Agent Extended (order history + flags) ───────────────

DISPUTE_TYPES = ["PRICE_DISPUTE","QUALITY_CLAIM","DELIVERY_DELAY","NONE","NONE","NONE"]

def gen_risk(knkk_rows):
    rows = []
    for cust in knkk_rows:
        num_orders   = random.randint(5, 80)
        disputed     = random.randint(0, max(1, int(num_orders * 0.15)))
        late_payments = random.randint(0, max(1, int(num_orders * 0.2)))
        rows.append({
            "KUNNR":            cust["KUNNR"],
            "CTLPC":            cust["CTLPC"],          # risk category
            "CTLPC_DESC":       cust["CTLPC_DESC"],
            "TOTAL_ORDERS":     num_orders,
            "DISPUTED_ORDERS":  disputed,
            "DISPUTE_RATE":     round(disputed / num_orders, 4),
            "LATE_PAYMENTS":    late_payments,
            "LATE_PAY_RATE":    round(late_payments / num_orders, 4),
            "LAST_DISPUTE_TYPE": random.choice(DISPUTE_TYPES),
            "LAST_DISPUTE_DATE": rand_date(365, 30) if disputed > 0 else "",
            "CRBLB":            cust["CRBLB"],           # blocked flag
            "BLACKLIST":        "X" if cust["CTLPC"] == "003" and disputed > 5 else "",
            "CASHD":            cust["CASHD"],           # last payment date
            "AVG_DSO_DAYS":     random.randint(20, 75), # avg days sales outstanding
            "VBAK_CTLPC":       cust["CTLPC"],          # risk at last order creation
        })
    return rows

RISK_FIELDS = ["KUNNR","CTLPC","CTLPC_DESC","TOTAL_ORDERS","DISPUTED_ORDERS",
               "DISPUTE_RATE","LATE_PAYMENTS","LATE_PAY_RATE","LAST_DISPUTE_TYPE",
               "LAST_DISPUTE_DATE","CRBLB","BLACKLIST","CASHD","AVG_DSO_DAYS","VBAK_CTLPC"]

# ── MAIN ──────────────────────────────────────────────────────────────────────

def main():
    print("\nCommitOS — Generating synthetic ERP data\n")

    mara_rows     = gen_mara()
    mard_rows     = gen_mard(mara_rows)
    vbak_rows     = gen_open_orders(mara_rows)
    knkk_rows     = gen_knkk()
    mbew_rows     = gen_mbew(mara_rows)
    supplier_rows = gen_suppliers(mara_rows)
    tvro_rows     = gen_tvro()
    risk_rows     = gen_risk(knkk_rows)

    write_csv("MARA_material_master.csv",   mara_rows,     MARA_FIELDS)
    write_csv("MARD_inventory_stock.csv",   mard_rows,     MARD_FIELDS)
    write_csv("VBAK_open_orders.csv",       vbak_rows,     VBAK_FIELDS)
    write_csv("KNKK_customer_credit.csv",   knkk_rows,     KNKK_FIELDS)
    write_csv("MBEW_margin_rules.csv",      mbew_rows,     MBEW_FIELDS)
    write_csv("LFA1_suppliers.csv",         supplier_rows, LFA1_FIELDS)
    write_csv("TVRO_logistics_routes.csv",  tvro_rows,     TVRO_FIELDS)
    write_csv("KNKK_RISK_customer_risk.csv",risk_rows,     RISK_FIELDS)

    print(f"\nDone. 8 CSV files generated.")
    print("SAP table mapping:")
    print("  MARA  → Product catalog (Inventory agent)")
    print("  MARD  → Warehouse stock levels (Inventory agent)")
    print("  VBAK  → Open sales orders / backlog (all agents context)")
    print("  KNKK  → Customer credit limits & exposure (Credit agent)")
    print("  MBEW  → Cost price & floor margin (Margin agent)")
    print("  LFA1  → Supplier capacity & lead times (Supplier agent)")
    print("  TVRO  → Logistics routes & carrier slots (Logistics agent)")
    print("  KNKK_RISK → Risk scores, dispute history, flags (Risk agent)")

if __name__ == "__main__":
    main()

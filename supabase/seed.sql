-- =============================================================================
-- Kreston Pedabo PBC Portal — reference seed data
-- Engagement types, master categories and the standard master checklist.
-- Demo users / client / engagement are created by `npm run seed:demo`
-- (scripts/seed-demo.ts) because users must be created through Supabase Auth.
-- Safe to re-run: uses ON CONFLICT on natural keys.
-- =============================================================================

insert into public.engagement_types (code, name, code_prefix, sort_order) values
  ('SA', 'Statutory Audit', 'SA', 10),
  ('TX', 'Tax',             'TX', 20),
  ('AD', 'Advisory',        'AD', 30),
  ('DD', 'Due Diligence',   'DD', 40)
on conflict (code) do update set name = excluded.name, code_prefix = excluded.code_prefix, sort_order = excluded.sort_order;

insert into public.master_categories (code, name, sort_order, description) values
  ('GEN', 'General & Permanent File',           10, 'Constitutional, governance and prior-year documents'),
  ('FST', 'Financial Statements & Trial Balance', 20, 'Draft financial statements, TB, ledgers and journals'),
  ('REV', 'Revenue',                            30, 'Sales, contracts and revenue recognition support'),
  ('REC', 'Receivables',                        40, 'Trade and other receivables'),
  ('INV', 'Inventory',                          50, 'Stock counts, valuation and costing'),
  ('PPE', 'Property, Plant & Equipment',        60, 'Fixed asset register, additions, disposals, title'),
  ('PAY', 'Payables & Accruals',                70, 'Trade payables, accruals and provisions'),
  ('CSH', 'Cash & Bank',                        80, 'Bank statements, reconciliations and confirmations'),
  ('BOR', 'Borrowings',                         90, 'Loans, facilities and finance costs'),
  ('HR',  'Payroll & HR',                      100, 'Payroll, staff costs and statutory deductions'),
  ('TAX', 'Tax',                               110, 'CIT, VAT, WHT, PAYE and tax clearance'),
  ('LEG', 'Legal & Regulatory',                120, 'Litigation, regulatory filings and compliance'),
  ('RPT', 'Related Parties',                   130, 'Related party identification and transactions'),
  ('OTH', 'Other',                             140, 'Anything else requested by the engagement team')
on conflict (code) do update set name = excluded.name, sort_order = excluded.sort_order, description = excluded.description;

-- -----------------------------------------------------------------------------
-- Master checklist items (guidance = the item's Description shown to the client)
-- columns: code, category, title, guidance, default folder, file types (legacy, not enforced),
--          critical, priority, engagement types, sort
-- -----------------------------------------------------------------------------
with src (code, cat, title, guidance, folder, ftypes, critical, priority, types, sort) as (values
  -- General & Permanent File ----------------------------------------------------
  ('GEN-01','GEN','Certificate of Incorporation (CAC)','Certified true copy of the Certificate of Incorporation issued by the Corporate Affairs Commission.','01 Permanent File','{pdf,jpg,png}',true,'important','{SA,TX,AD,DD}',10),
  ('GEN-02','GEN','CAC Status Report / Particulars of Directors and Shareholders','Current CAC status report (or Forms CAC 2 and CAC 7 for older companies) showing directors, shareholders and share capital.','01 Permanent File','{pdf}',true,'important','{SA,TX,AD,DD}',20),
  ('GEN-03','GEN','Memorandum and Articles of Association (MEMART)','Latest MEMART including any amendments or special resolutions.','01 Permanent File','{pdf}',true,'important','{SA,DD}',30),
  ('GEN-04','GEN','Board composition and directors'' KYC','List of directors with appointment dates, plus a valid means of identification for each director and beneficial owner (>=5% interest).','01 Permanent File','{pdf,jpg,png,xlsx}',true,'important','{SA,TX,AD,DD}',40),
  ('GEN-05','GEN','Group structure and organisation chart','Legal group structure (parent, subsidiaries, associates) and a management organisation chart.','01 Permanent File','{pdf,xlsx,docx,png}',false,'normal','{SA,AD,DD}',50),
  ('GEN-06','GEN','Prior year audited financial statements','Signed audited financial statements for the prior year, including the auditor''s report and management letter.','01 Permanent File','{pdf}',true,'important','{SA,TX,DD}',60),
  ('GEN-07','GEN','Signed engagement letter','Engagement letter countersigned by an authorised director.','01 Permanent File','{pdf}',true,'important','{SA,TX,AD,DD}',70),
  ('GEN-08','GEN','Board resolution appointing auditors','Board or AGM resolution appointing Kreston Pedabo as auditors for the period.','01 Permanent File','{pdf}',true,'important','{SA}',80),
  ('GEN-09','GEN','Professional clearance from predecessor auditor','For first-year engagements only: professional clearance letter / consent from the outgoing auditor.','01 Permanent File','{pdf}',true,'important','{SA}',90),
  ('GEN-10','GEN','Minutes of board and shareholders'' meetings','Minutes of all board, committee and general meetings held during the year and up to the date of this request.','01 Permanent File','{pdf,docx}',false,'normal','{SA,DD}',100),
  ('GEN-11','GEN','Accounting policies manual and chart of accounts','Current accounting policies, chart of accounts and any changes made during the year.','01 Permanent File','{pdf,docx,xlsx}',false,'normal','{SA,AD}',110),
  ('GEN-12','GEN','Significant contracts and agreements','Copies of major contracts entered into or renewed during the year (customers, suppliers, leases, JV agreements).','01 Permanent File','{pdf,zip}',false,'normal','{SA,DD}',120),
  -- Financial Statements & TB --------------------------------------------------
  ('FST-01','FST','Final trial balance','Trial balance at year end in Excel, mapped to financial statement line items.','02 Financial Statements','{xlsx,xls,csv}',false,'important','{SA,TX,DD}',10),
  ('FST-02','FST','Draft financial statements','Management''s draft financial statements with notes, in Word or Excel.','02 Financial Statements','{xlsx,docx,pdf}',false,'important','{SA,DD}',20),
  ('FST-03','FST','General ledger (full year)','Full general ledger export for the year in Excel/CSV.','02 Financial Statements','{xlsx,csv,zip}',false,'important','{SA,DD}',30),
  ('FST-04','FST','Journal entries listing','All manual and system journals posted during the year, including post year-end adjustments.','02 Financial Statements','{xlsx,csv}',false,'normal','{SA}',40),
  ('FST-05','FST','Monthly management accounts','Management accounts for each month of the year.','02 Financial Statements','{xlsx,pdf,zip}',false,'normal','{SA,AD,DD}',50),
  ('FST-06','FST','Budget and forecast','Board-approved budget for the year and forecast for the next 12 months (going concern assessment).','02 Financial Statements','{xlsx,pdf}',false,'normal','{SA,AD,DD}',60),
  ('FST-07','FST','Subsequent events schedule','Significant events between year end and the date of this request, with supporting documents.','02 Financial Statements','{pdf,docx,xlsx}',false,'normal','{SA,DD}',70),
  -- Revenue --------------------------------------------------------------------
  ('REV-01','REV','Revenue analysis by product/customer/month','Breakdown of revenue by stream, major customers and month, reconciled to the TB.','03 Revenue','{xlsx,csv}',false,'normal','{SA,TX,DD}',10),
  ('REV-02','REV','Sales invoices register','Listing of all sales invoices issued in the year.','03 Revenue','{xlsx,csv}',false,'normal','{SA,TX}',20),
  ('REV-03','REV','Credit notes and returns','Listing of credit notes issued in the year and after year end, with reasons.','03 Revenue','{xlsx,pdf}',false,'normal','{SA}',30),
  ('REV-04','REV','Major customer contracts (IFRS 15)','Contracts with key customers, including performance obligations, variable consideration and payment terms.','03 Revenue','{pdf,zip}',false,'normal','{SA,DD}',40),
  ('REV-05','REV','Cut-off documents','Last 10 delivery notes/invoices before and first 10 after year end.','03 Revenue','{pdf,zip,xlsx}',false,'normal','{SA}',50),
  -- Receivables ----------------------------------------------------------------
  ('REC-01','REC','Aged receivables listing','Aged trade receivables at year end reconciled to the TB and control account.','04 Receivables','{xlsx,csv}',false,'normal','{SA,DD}',10),
  ('REC-02','REC','Expected credit loss (IFRS 9) computation','ECL model, provision matrix and assumptions used.','04 Receivables','{xlsx}',false,'normal','{SA}',20),
  ('REC-03','REC','Subsequent receipts','Cash received after year end against year-end balances, with bank evidence.','04 Receivables','{xlsx,pdf}',false,'normal','{SA}',30),
  ('REC-04','REC','Prepayments and other receivables schedule','Breakdown of prepayments, staff loans, deposits and other receivables with support.','04 Receivables','{xlsx,pdf}',false,'normal','{SA}',40),
  -- Inventory ------------------------------------------------------------------
  ('INV-01','INV','Year-end stock count sheets and instructions','Signed stock count sheets, count instructions and summary of differences.','05 Inventory','{pdf,xlsx,zip}',false,'important','{SA,DD}',10),
  ('INV-02','INV','Inventory valuation listing','Final priced inventory listing by item, reconciled to the TB.','05 Inventory','{xlsx,csv}',false,'normal','{SA,DD}',20),
  ('INV-03','INV','Costing method and overhead absorption','Basis of costing (FIFO/weighted average), overhead absorption workings.','05 Inventory','{xlsx,docx}',false,'normal','{SA}',30),
  ('INV-04','INV','Slow-moving and obsolete stock analysis','Ageing of inventory and NRV / obsolescence provision workings.','05 Inventory','{xlsx}',false,'normal','{SA}',40),
  ('INV-05','INV','Goods in transit and third-party stock','Confirmations/support for goods in transit and stock held by or for third parties.','05 Inventory','{pdf,xlsx}',false,'low','{SA}',50),
  -- PPE ------------------------------------------------------------------------
  ('PPE-01','PPE','Fixed asset register','Fixed asset register with cost, accumulated depreciation and NBV by class, reconciled to the TB.','06 PPE','{xlsx,csv}',false,'important','{SA,TX,DD}',10),
  ('PPE-02','PPE','Additions with invoices','Schedule of additions with supplier invoices and approvals.','06 PPE','{xlsx,pdf,zip}',false,'normal','{SA,TX}',20),
  ('PPE-03','PPE','Disposals and write-offs','Schedule of disposals with proceeds, approvals and gain/loss workings.','06 PPE','{xlsx,pdf}',false,'normal','{SA,TX}',30),
  ('PPE-04','PPE','Title documents for land, buildings and vehicles','Certificates of occupancy, deeds of assignment and vehicle registration documents.','06 PPE','{pdf,zip}',false,'normal','{SA,DD}',40),
  ('PPE-05','PPE','Capital work in progress and commitments','CWIP schedule and capital commitments at year end.','06 PPE','{xlsx,pdf}',false,'normal','{SA}',50),
  ('PPE-06','PPE','Leases (IFRS 16) schedule','Lease agreements, right-of-use asset and lease liability computations.','06 PPE','{xlsx,pdf}',false,'normal','{SA}',60),
  -- Payables ------------------------------------------------------------------
  ('PAY-01','PAY','Aged payables listing','Aged trade payables at year end reconciled to the TB.','07 Payables & Accruals','{xlsx,csv}',false,'normal','{SA,DD}',10),
  ('PAY-02','PAY','Supplier statements and reconciliations','Year-end statements from major suppliers with reconciliations.','07 Payables & Accruals','{pdf,xlsx,zip}',false,'normal','{SA}',20),
  ('PAY-03','PAY','Accruals and provisions schedule','Breakdown of accruals and provisions (IAS 37) with basis of estimate.','07 Payables & Accruals','{xlsx}',false,'normal','{SA}',30),
  ('PAY-04','PAY','Payments after year end','Listing of payments made after year end (search for unrecorded liabilities).','07 Payables & Accruals','{xlsx,csv}',false,'normal','{SA}',40),
  -- Cash & Bank ----------------------------------------------------------------
  ('CSH-01','CSH','Bank statements for all accounts','Statements for every bank account for the full year and the month after year end.','08 Cash & Bank','{pdf,zip}',false,'important','{SA,DD}',10),
  ('CSH-02','CSH','Year-end bank reconciliations','Signed bank reconciliations for all accounts at year end.','08 Cash & Bank','{xlsx,pdf}',false,'important','{SA}',20),
  ('CSH-03','CSH','List of bank accounts and signatories','All bank accounts (open and closed in the year) with mandates and signatories, for bank confirmations.','08 Cash & Bank','{xlsx,pdf}',false,'normal','{SA,DD}',30),
  ('CSH-04','CSH','Cash count certificate','Petty cash count certificate at year end.','08 Cash & Bank','{pdf,jpg}',false,'low','{SA}',40),
  -- Borrowings -----------------------------------------------------------------
  ('BOR-01','BOR','Loan and facility agreements','Offer letters and agreements for all loans and facilities, including covenants and security.','09 Borrowings','{pdf,zip}',false,'normal','{SA,DD}',10),
  ('BOR-02','BOR','Loan schedule and interest computation','Movement schedule for each facility with interest computation, reconciled to the TB.','09 Borrowings','{xlsx}',false,'normal','{SA,DD}',20),
  ('BOR-03','BOR','Covenant compliance calculations','Workings showing compliance (or waiver) with financial covenants at year end.','09 Borrowings','{xlsx,pdf}',false,'normal','{SA,DD}',30),
  -- Payroll & HR ---------------------------------------------------------------
  ('HR-01','HR','Payroll summaries for each month','Monthly payroll summaries reconciled to staff costs in the TB.','10 Payroll & HR','{xlsx,pdf,zip}',false,'normal','{SA,TX,DD}',10),
  ('HR-02','HR','Staff list and headcount','Staff list at year end with grade, department and date joined; headcount movement in the year.','10 Payroll & HR','{xlsx}',false,'normal','{SA,DD}',20),
  ('HR-03','HR','Pension remittances (PenCom)','Evidence of monthly pension remittances to PFAs and schedules.','10 Payroll & HR','{pdf,xlsx,zip}',false,'normal','{SA,TX,DD}',30),
  ('HR-04','HR','NSITF, ITF and NHF remittances','Evidence of statutory remittances for the year.','10 Payroll & HR','{pdf,zip}',false,'normal','{SA,TX}',40),
  ('HR-05','HR','Directors'' remuneration schedule','Emoluments of directors and key management personnel.','10 Payroll & HR','{xlsx}',false,'normal','{SA}',50),
  ('HR-06','HR','Employee benefit obligations (IAS 19)','Gratuity/defined benefit valuation report and assumptions, if applicable.','10 Payroll & HR','{pdf,xlsx}',false,'low','{SA}',60),
  -- Tax ------------------------------------------------------------------------
  ('TAX-01','TAX','Tax Identification Number (TIN) evidence','Evidence of the company''s TIN registration.','11 Tax','{pdf,jpg,png}',true,'important','{TX}',10),
  ('TAX-02','TAX','Tax Clearance Certificate (TCC)','Current TCC covering the last three years.','11 Tax','{pdf,jpg}',false,'important','{SA,TX,DD}',20),
  ('TAX-03','TAX','Companies Income Tax returns and computations','Filed CIT returns, tax computations, capital allowance schedules and payment receipts for the last three years.','11 Tax','{pdf,xlsx,zip}',false,'normal','{SA,TX,DD}',30),
  ('TAX-04','TAX','VAT returns and remittances','Monthly VAT returns, schedules and payment evidence for the year.','11 Tax','{pdf,xlsx,zip}',false,'normal','{SA,TX,DD}',40),
  ('TAX-05','TAX','Withholding tax returns and credit notes','WHT deducted and remitted schedules, receipts, and WHT credit notes received.','11 Tax','{pdf,xlsx,zip}',false,'normal','{SA,TX,DD}',50),
  ('TAX-06','TAX','PAYE returns and annual filing','Monthly PAYE remittances to the State IRS and annual employer returns.','11 Tax','{pdf,xlsx,zip}',false,'normal','{SA,TX,DD}',60),
  ('TAX-07','TAX','Tax authority correspondence and assessments','Letters, audits, assessments and objections with the tax authorities (federal and state).','11 Tax','{pdf,zip}',false,'normal','{SA,TX,DD}',70),
  ('TAX-08','TAX','Deferred tax computation','Deferred tax workings (temporary differences, rates applied).','11 Tax','{xlsx}',false,'normal','{SA,TX}',80),
  ('TAX-09','TAX','Development levy / education tax computation','Computation and payment evidence for the applicable levy for the period.','11 Tax','{xlsx,pdf}',false,'normal','{SA,TX}',90),
  -- Legal & Regulatory ---------------------------------------------------------
  ('LEG-01','LEG','Litigation and claims schedule','All pending or threatened litigation with solicitors'' names and assessment of outcome.','12 Legal & Regulatory','{xlsx,pdf,docx}',false,'normal','{SA,DD}',10),
  ('LEG-02','LEG','Solicitors'' details for legal confirmation','Names and addresses of all solicitors used in the year.','12 Legal & Regulatory','{xlsx,docx}',false,'normal','{SA}',20),
  ('LEG-03','LEG','Regulatory licences and returns','Operating licences and filings with sector regulators (e.g. CBN, SEC, NAICOM, NCC) as applicable.','12 Legal & Regulatory','{pdf,zip}',false,'normal','{SA,DD}',30),
  ('LEG-04','LEG','CAC annual returns filed','Evidence of CAC annual returns filed for the last three years.','12 Legal & Regulatory','{pdf}',false,'normal','{SA,DD}',40),
  ('LEG-05','LEG','FRC registration and filings','Financial Reporting Council of Nigeria registration and filing evidence, where applicable.','12 Legal & Regulatory','{pdf}',false,'low','{SA}',50),
  ('LEG-06','LEG','Insurance policies schedule','Schedule of insurance policies in force with sums insured and expiry dates.','12 Legal & Regulatory','{xlsx,pdf}',false,'low','{SA,DD}',60),
  -- Related Parties ------------------------------------------------------------
  ('RPT-01','RPT','Related parties listing','All related parties (entities and individuals) and nature of relationship.','13 Related Parties','{xlsx,docx}',false,'normal','{SA,TX,DD}',10),
  ('RPT-02','RPT','Related party transactions and balances','Transactions in the year and balances at year end with each related party, with agreements.','13 Related Parties','{xlsx,pdf}',false,'normal','{SA,TX,DD}',20),
  ('RPT-03','RPT','Transfer pricing documentation','TP policy, contemporaneous documentation and TP declaration, where applicable.','13 Related Parties','{pdf,docx,zip}',false,'normal','{TX,DD}',30),
  -- Other ----------------------------------------------------------------------
  ('OTH-01','OTH','Management representation letter (draft review)','Review and sign the draft representation letter when issued by the engagement team.','14 Other','{pdf,docx}',false,'normal','{SA}',10),
  ('OTH-02','OTH','Business plan and financial model','Current business plan and financial model supporting the advisory scope.','14 Other','{xlsx,pdf,docx}',false,'normal','{AD,DD}',20),
  ('OTH-03','OTH','Data room index','Index of documents provided for due diligence.','14 Other','{xlsx,pdf}',false,'normal','{DD}',30),
  ('OTH-04','OTH','Other information requested','Any other information requested by the engagement team.','14 Other','{pdf,xlsx,docx,zip}',false,'low','{SA,TX,AD,DD}',99)
), upserted as (
  insert into public.master_checklist_items (code, category_id, title, guidance, default_folder, expected_file_types,
                                             is_critical, default_priority, sort_order)
  select s.code, c.id, s.title, s.guidance, s.folder, s.ftypes::text[], s.critical, s.priority::public.item_priority, s.sort
  from src s join public.master_categories c on c.code = s.cat
  on conflict (code) do update set
    category_id = excluded.category_id, title = excluded.title, guidance = excluded.guidance,
    default_folder = excluded.default_folder, expected_file_types = excluded.expected_file_types,
    is_critical = excluded.is_critical, default_priority = excluded.default_priority, sort_order = excluded.sort_order
  returning id, code
)
insert into public.master_item_engagement_types (master_item_id, engagement_type_id)
select u.id, t.id
from upserted u
join src s on s.code = u.code
join public.engagement_types t on t.code = any(s.types::text[])
on conflict do nothing;

-- =============================================================================
-- 0009: managed default folders, extra categories and items, file classes
-- =============================================================================
insert into public.master_folders (name, sort_order) values
  ('01 Permanent File', 10), ('Current File', 15),
  ('02 Financial Statements', 20), ('03 Revenue', 30), ('04 Receivables', 40),
  ('05 Inventory', 50), ('06 PPE', 60), ('07 Payables & Accruals', 70), ('08 Cash & Bank', 80),
  ('09 Borrowings', 90), ('10 Payroll & HR', 100), ('11 Tax', 110), ('12 Legal & Regulatory', 120),
  ('13 Related Parties', 130), ('14 Other', 140), ('15 Journals', 150), ('16 Estimates', 160),
  ('17 Going Concern', 170), ('18 IT Environment', 180)
on conflict ((lower(name))) do nothing;

insert into public.master_categories (code, name, sort_order, description) values
  ('JNL', 'Tests of journals',        150, 'Journal listings, posting rights and approvals for journal entry testing'),
  ('EST', 'Accounting estimates',     160, 'Models, assumptions and valuations behind significant estimates'),
  ('GCA', 'Going concern assessment', 170, 'Management''s assessment, forecasts and financing'),
  ('ITE', 'IT environment',           180, 'Systems, IT general controls and service organisation reports')
on conflict (code) do update set name = excluded.name, sort_order = excluded.sort_order, description = excluded.description;

with src (code, cat, title, guidance, folder, critical, priority, fclass, types, sort) as (values
  -- Tests of journals ----------------------------------------------------------
  ('JNL-01','JNL','General ledger journal listing for the year','Complete listing of every journal posted in the year (system and manual) with journal number, posting date, effective date, preparer, approver, account, amount and narration, reconciled to the trial balance movements.','15 Journals',false,'important','current','{SA,DD}',10),
  ('JNL-02','JNL','Users who can post journals and their access rights','System report of all users able to create, post or approve journals in the accounting system, with their roles/access rights and any changes made during the year.','15 Journals',false,'normal','current','{SA}',20),
  ('JNL-03','JNL','Manual, top-side journals and period-end adjustments with approvals','Listing of manual and top-side (consolidation/reporting) journals and all period-end adjustments, with supporting documents and evidence of review and approval.','15 Journals',false,'normal','current','{SA,DD}',30),
  ('JNL-04','JNL','Journal approval policy','Policy or procedures for preparing, reviewing and approving journals, including authority limits and segregation of duties.','15 Journals',false,'normal','permanent','{SA}',40),
  -- Accounting estimates -------------------------------------------------------
  ('EST-01','EST','ECL / impairment of receivables model','Expected credit loss (IFRS 9) model for receivables: provision matrix or PD/LGD approach, data inputs, forward-looking information and reconciliation to the allowance in the TB.','16 Estimates',false,'normal','current','{SA,DD}',10),
  ('EST-02','EST','Impairment assessments of non-financial assets','Impairment indicators review and, where required, value-in-use or fair value less costs of disposal workings for PPE, intangibles, goodwill and investments (IAS 36).','16 Estimates',false,'normal','current','{SA,DD}',20),
  ('EST-03','EST','Provisions and contingent liabilities schedule','Schedule of provisions and contingent liabilities (IAS 37) with movements, basis of each estimate and supporting correspondence.','16 Estimates',false,'normal','current','{SA,DD}',30),
  ('EST-04','EST','Useful lives and residual values review','Management''s annual review of useful lives, residual values and depreciation methods by asset class, with any changes made.','16 Estimates',false,'low','current','{SA}',40),
  ('EST-05','EST','Fair value measurements and valuation reports','Valuation reports (e.g. property, investments, biological assets, financial instruments), the valuer''s engagement terms and the fair value hierarchy disclosures (IFRS 13).','16 Estimates',false,'normal','current','{SA,DD}',50),
  ('EST-06','EST','Key assumptions and sensitivity analysis','Summary of the key assumptions behind significant estimates and the sensitivity of the results to reasonably possible changes.','16 Estimates',false,'normal','current','{SA}',60),
  -- Going concern assessment ---------------------------------------------------
  ('GCA-01','GCA','Management''s going concern assessment','Board-approved assessment of the entity''s ability to continue as a going concern for at least 12 months from the approval of the financial statements, with the key judgements made.','17 Going Concern',false,'important','current','{SA,DD}',10),
  ('GCA-02','GCA','12-month cash flow forecast','Monthly cash flow forecast covering at least 12 months from the expected date of approval of the financial statements, with assumptions.','17 Going Concern',false,'normal','current','{SA,DD}',20),
  ('GCA-03','GCA','Borrowing facilities and covenant compliance','Facilities available (limits, maturity and renewal status) and covenant compliance calculations at year end and over the forecast period.','17 Going Concern',false,'normal','current','{SA,DD}',30),
  ('GCA-04','GCA','Post year-end management accounts','Management accounts for each month after the year end up to the latest available period.','17 Going Concern',false,'normal','current','{SA,DD}',40),
  ('GCA-05','GCA','Board minutes on financing','Minutes and papers of board meetings that discussed financing, capital, liquidity or support from shareholders and lenders.','17 Going Concern',false,'normal','current','{SA}',50),
  -- IT environment -------------------------------------------------------------
  ('ITE-01','ITE','List of systems and applications','Systems and applications relevant to financial reporting (accounting, ERP, payroll, banking, inventory) with versions, hosting and the owners responsible.','18 IT Environment',false,'normal','permanent','{SA,DD}',10),
  ('ITE-02','ITE','IT general controls policies','IT policies and procedures covering access security, change management, operations, backup and incident management.','18 IT Environment',false,'normal','permanent','{SA}',20),
  ('ITE-03','ITE','User access listing and access reviews','Current user listing for each key system with roles, plus evidence of periodic user access reviews and of removing leavers.','18 IT Environment',false,'normal','current','{SA}',30),
  ('ITE-04','ITE','Change management log','Log of system changes, upgrades and patches in the year with test and approval evidence.','18 IT Environment',false,'low','current','{SA}',40),
  ('ITE-05','ITE','Backup and recovery','Backup schedule and evidence of backups and restore tests performed in the year, and the disaster recovery plan.','18 IT Environment',false,'low','current','{SA}',50),
  ('ITE-06','ITE','Service organisation (SOC) reports for outsourced systems','SOC 1 / ISAE 3402 reports (and bridge letters) for outsourced or cloud systems used in financial reporting, e.g. payroll bureau or hosted ERP.','18 IT Environment',false,'normal','current','{SA,DD}',60)
), upserted as (
  insert into public.master_checklist_items (code, category_id, title, guidance, default_folder,
                                             is_critical, default_priority, file_class, sort_order)
  select s.code, c.id, s.title, s.guidance, s.folder, s.critical, s.priority::public.item_priority,
         s.fclass::public.file_class, s.sort
  from src s join public.master_categories c on c.code = s.cat
  on conflict (code) do update set
    category_id = excluded.category_id, title = excluded.title, guidance = excluded.guidance,
    default_folder = excluded.default_folder, is_critical = excluded.is_critical,
    default_priority = excluded.default_priority, file_class = excluded.file_class, sort_order = excluded.sort_order
  returning id, code
)
insert into public.master_item_engagement_types (master_item_id, engagement_type_id)
select u.id, t.id
from upserted u
join src s on s.code = u.code
join public.engagement_types t on t.code = any(s.types::text[])
on conflict do nothing;

-- File classes for the standard items. Only fills items that have none yet
-- (so later choices made in the portal are kept) and does not bump master
-- revisions; engagement items without a class pick it up from their master.
do $$
begin
  perform set_config('app.master_quiet', 'on', true);
  update public.master_checklist_items set file_class = 'permanent'
  where file_class is null and code in (
    'GEN-01','GEN-02','GEN-03','GEN-04','GEN-05','GEN-06','GEN-09','GEN-11','GEN-12',
    'PPE-04','BOR-01','TAX-01','LEG-03','JNL-04','ITE-01','ITE-02');
  update public.master_checklist_items set file_class = 'current' where file_class is null;
  perform set_config('app.master_quiet', '', true);
  update public.request_items ri set file_class = mi.file_class
  from public.master_checklist_items mi
  where ri.master_item_id = mi.id and ri.file_class is null and mi.file_class is not null;
end $$;

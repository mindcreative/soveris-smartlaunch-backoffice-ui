import {render,screen,within} from '@testing-library/react'
import {describe,expect,it} from 'vitest'
import {CreditActivityResults,ProviderExpenseResults} from './ReportResults'
import {parseCreditActivity,parseProviderExpense} from '../../../api/billingReportsApi'
import {creditFixture,expenseFixture,REPORT_CLIENT,REPORT_RANGE} from '../../../test/billingReportsFixture'
describe('separate exact report data and equivalent views',()=>{
 it('shows credit formulas, provenance, every metric and accessible table relationships',()=>{
  const page=parseCreditActivity(creditFixture(),REPORT_CLIENT,REPORT_RANGE);render(<CreditActivityResults page={page}/>);
  expect(screen.getByText('Full-window credit totals')).toBeInTheDocument();expect(screen.getAllByText(/abstract Soveris credits/).length).toBeGreaterThan(0)
  expect(screen.getAllByText(/grants − posted consumption/).length).toBeGreaterThan(0)
  for(const label of ['Grants','Consumption','Posted consumption','Releases','Net activity','Holds created','Holds closed','Hold net activity','Unused on commit','Released without consumption','Usage posting difference','Adjustments','Reversals','Consumption-to-grant ratio'])expect(screen.getAllByText(label).length).toBeGreaterThan(0)
  const table=screen.getByRole('table',{name:/Credit activity by UTC period/});expect(within(table).getAllByRole('columnheader').length).toBeGreaterThan(1);expect(within(table).getAllByRole('rowheader').length).toBe(1)
  expect(screen.getByText(/not current balance/)).toBeInTheDocument();expect(screen.getAllByText('0.40000000').length).toBeGreaterThan(0)
 })
 it('shows separate expense provenance and exact four-place money without adding retained estimates',()=>{
  render(<ProviderExpenseResults page={parseProviderExpense(expenseFixture(REPORT_CLIENT,null,'<img src=x onerror=alert(1)>'),REPORT_CLIENT,REPORT_RANGE)}/>);
  expect(screen.getByText('Full-window expense totals')).toBeInTheDocument();expect(screen.getAllByText('5.0000 USD').length).toBeGreaterThan(0);expect(screen.getAllByText('6.0000 USD').length).toBeGreaterThan(0);expect(screen.queryByText('9.0000 USD')).not.toBeInTheDocument();expect(screen.getAllByText('Estimate sources (retained evidence)').length).toBeGreaterThan(0);expect(screen.getAllByText('Actual sources').length).toBeGreaterThan(0);expect(document.querySelector('img')).toBeNull()
 })
 it('distinguishes unknown-only evidence, measured zero, and disabled dimensions',()=>{
  const page=parseProviderExpense(expenseFixture(),REPORT_CLIENT,REPORT_RANGE)
  page.totals=[{currencyCode:null,metrics:{...page.totals[0].metrics,effectiveExpense:null}},{currencyCode:'EUR',metrics:{...page.totals[0].metrics,effectiveExpense:'0.0000'}}]
  page.filters.dimensions=['currency'];page.items=page.items.map(i=>({...i,key:{currencyCode:null,provider:null,model:null,status:null,source:null},metrics:{...i.metrics,effectiveExpense:null}}))
  render(<ProviderExpenseResults page={page}/>);expect(screen.getAllByText('Unknown currency').length).toBeGreaterThan(0);expect(screen.getAllByText('Not available — unknown currency').length).toBeGreaterThan(0);expect(screen.getAllByText('0.0000 EUR').length).toBeGreaterThan(0);expect(screen.getAllByText('Not grouped').length).toBeGreaterThan(0)
 })
})

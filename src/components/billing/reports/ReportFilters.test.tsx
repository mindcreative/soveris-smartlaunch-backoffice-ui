import {useState} from 'react'
import {render,screen} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {describe,expect,it} from 'vitest'
import {ReportFilters} from './ReportFilters'
import {normalizeReportFilters} from '../../../api/billingReportsApi'
import {REPORT_RANGE} from '../../../test/billingReportsFixture'
function Harness(){const [credit,c]=useState(()=>normalizeReportFilters('credit',REPORT_RANGE)),[expense,e]=useState(()=>normalizeReportFilters('expense',REPORT_RANGE));return <><ReportFilters credit={credit} expense={expense} onApply={(a,b)=>{c(a);e(b)}}/><p data-testid="applied">{credit.from};{credit.pageSize}</p></>}
describe('accepted filter draft identity',()=>{
 it('accepts offset UTC and zero-prefixed page size without leaving a false draft notice',async()=>{
  render(<Harness/>);const user=userEvent.setup();await user.clear(screen.getByLabelText('From (inclusive UTC)'));await user.type(screen.getByLabelText('From (inclusive UTC)'),'2026-09-01T01:00:00+01:00');await user.clear(screen.getByLabelText('Credit periods per page'));await user.type(screen.getByLabelText('Credit periods per page'),'01');await user.click(screen.getByRole('button',{name:'Apply filters'}));expect(screen.getByRole('status')).toHaveTextContent('Drafts match applied filters.');expect(screen.getByTestId('applied')).toHaveTextContent('2026-09-01T00:00:00.000000Z;1');expect(screen.getByLabelText('From (inclusive UTC)')).toHaveValue('2026-09-01T01:00:00+01:00');expect(screen.getByLabelText('Credit periods per page')).toHaveValue('01')
  await user.type(screen.getByLabelText('Provider (exact match)'),'later draft');expect(screen.getByRole('status')).toHaveTextContent('Unapplied changes');await user.clear(screen.getByLabelText('From (inclusive UTC)'));await user.type(screen.getByLabelText('From (inclusive UTC)'),'bad');await user.click(screen.getByRole('button',{name:'Apply filters'}));expect(screen.getByRole('alert')).toHaveFocus();expect(screen.getByRole('status')).toHaveTextContent('Unapplied changes');expect(screen.getByLabelText('Provider (exact match)')).toHaveValue('later draft');expect(screen.getByTestId('applied')).toHaveTextContent('2026-09-01T00:00:00.000000Z;1')
 })
})

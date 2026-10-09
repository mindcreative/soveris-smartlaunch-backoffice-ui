import {render,screen} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {describe,expect,it,vi} from 'vitest'
import {ReportState} from './ReportState'
import type {useFrozenReport} from '../../../queries/billingReportQueries'
import {parseCreditActivity} from '../../../api/billingReportsApi'
import {creditFixture,REPORT_CLIENT,REPORT_RANGE} from '../../../test/billingReportsFixture'
const page=parseCreditActivity(creditFixture(),REPORT_CLIENT,REPORT_RANGE)
const initial=():ReturnType<typeof useFrozenReport>=>({page,busy:false,error:null,stale:false,announcement:'',more:vi.fn(),refresh:vi.fn()})
describe('continuation recovery focus',()=>{
 it('preserves the continuation control across transient failure, pending retry and non-final success',async()=>{
  const user=userEvent.setup(),report=initial();const {rerender}=render(<ReportState kind="credit" report={report}/>);const trigger=screen.getByRole('button',{name:'Load more'});trigger.focus();await user.keyboard('{Enter}');rerender(<ReportState kind="credit" report={{...report,busy:true}}/>);rerender(<ReportState kind="credit" report={{...report,error:{kind:'transient',message:'Partial load',retryAt:0}}}/>);const retry=screen.getByRole('button',{name:'Retry loading more'});expect(retry).toBe(trigger);expect(retry).toHaveFocus();await user.keyboard('{Enter}');rerender(<ReportState kind="credit" report={{...report,busy:true}}/>);expect(screen.getByRole('button',{name:'Loading more…'})).toHaveFocus();rerender(<ReportState kind="credit" report={report}/>);expect(screen.getByRole('button',{name:'Load more'})).toHaveFocus()
 })
 it.each(['invalid','contract'] as const)('focuses named recovery when continuation becomes unavailable (%s)',async kind=>{
  const report=initial(),user=userEvent.setup();const {rerender}=render(<ReportState kind="credit" report={report}/>);screen.getByRole('button',{name:'Load more'}).focus();await user.keyboard('{Enter}');rerender(<ReportState kind="credit" report={{...report,error:{kind,message:'Cannot continue',retryAt:0},stale:kind==='invalid',page:kind==='contract'?null:page}}/>);expect(screen.getByRole('status',{name:'Credit report recovery'})).toHaveFocus();await user.tab();expect(screen.getByRole('button',{name:kind==='invalid'?'Refresh report':'Try again'})).toHaveFocus()
 })
 it.each([false,true])('focuses named stale status when expiry removes a focused continuation (pending=%s)',async pending=>{
  const report=initial(),user=userEvent.setup();const {rerender}=render(<ReportState kind="credit" report={report}/>);screen.getByRole('button',{name:'Load more'}).focus();if(pending)await user.keyboard('{Enter}');rerender(<ReportState kind="credit" report={{...report,busy:pending,stale:true}}/>);expect(screen.getByRole('status',{name:'Credit report continuation unavailable'})).toHaveFocus();rerender(<ReportState kind="credit" report={{...report,stale:true}}/>);expect(screen.getByRole('status',{name:'Credit report continuation unavailable'})).toHaveFocus()
 })

 it('retains focus tracking after non-final success until idle expiry',async()=>{
  const report=initial(),user=userEvent.setup();const {rerender}=render(<ReportState kind="credit" report={report}/>);const trigger=screen.getByRole('button',{name:'Load more'});trigger.focus();await user.keyboard('{Enter}');rerender(<ReportState kind="credit" report={{...report,busy:true}}/>);rerender(<ReportState kind="credit" report={{...report,page:{...page,items:[...page.items]}}}/>);expect(trigger).toHaveFocus();rerender(<ReportState kind="credit" report={{...report,stale:true}}/>);expect(screen.getByRole('status',{name:'Credit report continuation unavailable'})).toHaveFocus()
 })

})

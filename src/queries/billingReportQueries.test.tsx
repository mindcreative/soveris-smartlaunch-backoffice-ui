import { QueryClient } from '@tanstack/react-query'
import { beforeEach,afterEach,describe,expect,it,vi } from 'vitest'
import { ReportTraversal } from './billingReportQueries'
import { billingReportKeys, retireReportScopes } from './billingReportKeys'
import { parseCreditActivity, parseProviderExpense } from '../api/billingReportsApi'
import { creditFixture, expenseFixture, REPORT_CLIENT, REPORT_RANGE } from '../test/billingReportsFixture'
import { clearPrivateClientScope,clearPrivateBillingQueries } from './billingQueries'
const credit=(cursor:string|null='next',day='01')=>parseCreditActivity(creditFixture(REPORT_CLIENT,cursor,day),REPORT_CLIENT,REPORT_RANGE)
const deferred=<T,>()=>{let resolve!:(v:T)=>void, reject!:(e:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
function setup(reader=vi.fn().mockResolvedValue(credit()),kind:'credit'|'expense'='credit') {const cache=new QueryClient();let authority='a';const t=new ReportTraversal(cache,kind,REPORT_CLIENT,kind==='credit'?REPORT_RANGE:{...REPORT_RANGE},()=>authority,()=>{},reader);return {t,cache,change:()=>{authority='b'},reader}}
describe('frozen private report traversals',()=>{
 beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-09T14:02:00Z'))})
 afterEach(()=>{retireReportScopes();vi.useRealTimers()})
 it('keeps totals and as-of while cursor-only pages append and explicit refresh replaces',async()=>{
  const {t,reader}=setup();await t.refresh();reader.mockResolvedValueOnce(credit(null,'02'));await t.more()
  expect(t.snapshot().page?.items).toHaveLength(2);expect(t.snapshot().page?.totals).toEqual(credit().totals)
  expect(reader.mock.calls[1][3]).toBe('next');reader.mockResolvedValueOnce(credit('new'));await t.refresh();expect(t.snapshot().page?.items).toHaveLength(1);t.retire()
 })
 it('locks duplicate continuations and rejects late successes after retirement',async()=>{
  const pending=deferred<ReturnType<typeof credit>>();const {t,reader}=setup();await t.refresh();reader.mockReturnValue(pending.promise);const a=t.more();void t.more();expect(reader).toHaveBeenCalledTimes(2);t.retire();pending.resolve(credit(null,'02'));await a;expect(t.snapshot().page).toBeNull()
 })
 it('refresh hides values synchronously and rejects prior traversal errors',async()=>{
  const pending=deferred<ReturnType<typeof credit>>();const {t,reader}=setup();await t.refresh();reader.mockReturnValueOnce(pending.promise);const old=t.more();const fresh=t.refresh();expect(t.snapshot().page).toBeNull();pending.reject({status:403});await Promise.all([old,fresh]);expect(t.snapshot().error).toBeNull();t.retire()
 })
 it('checks authority before success and denial handling even when transport ignores abort',async()=>{
  for(const rejected of [false,true]){const pending=deferred<ReturnType<typeof credit>>();const denied=vi.fn();let current='a';const t=new ReportTraversal(new QueryClient(),'credit',REPORT_CLIENT,REPORT_RANGE,()=>current,denied,()=>pending.promise);const work=t.refresh();current='b';if(rejected)pending.reject({status:401});else pending.resolve(credit());await work;expect(t.snapshot().page).toBeNull();expect(denied).not.toHaveBeenCalled();t.retire()}
 })
 it('retains valid pages only for transient/invalid continuation; hides integrity failures',async()=>{
  for(const status of [400,429,503,500]) {const {t,reader}=setup();await t.refresh();reader.mockRejectedValue({status,retryAfterSeconds:60,message:'private raw body'});await t.more();expect(t.snapshot().page!==null).toBe(status!==500);expect(t.snapshot().error?.message).not.toContain('private');if(status===400)expect(t.snapshot().stale).toBe(true);t.retire()}
 })
 it('rejects changed envelope, duplicate/regressing rows and repeated cursor',async()=>{
  for(const page of [credit('next','02'),credit(null,'01'),{...credit(null,'02'),asOf:'2026-10-09T14:00:00.123457Z'}]) {const {t,reader}=setup();await t.refresh();reader.mockResolvedValue(page);await t.more();expect(t.snapshot().page).toBeNull();expect(t.snapshot().error?.kind).toBe('contract');t.retire()}
 })
 it('denial in one section retires all private report scopes and cannot repopulate',async()=>{
  const pending=deferred<ReturnType<typeof credit>>();const {t}=setup(vi.fn(()=>pending.promise));const work=t.refresh();retireReportScopes(REPORT_CLIENT);pending.resolve(credit());await work;expect(t.snapshot().page).toBeNull();t.retire()
 })
 it('fixed expiry never silently opens a new snapshot',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-09T14:10:00Z'));const {t,reader}=setup();await t.refresh();vi.advanceTimersByTime(6*60000);expect(t.snapshot().stale).toBe(true);await t.more();expect(reader).toHaveBeenCalledTimes(1);t.retire();vi.useRealTimers()
 })
 it('private targeted/all cleanup cancels reports and retains other Clients',async()=>{
  const cache=new QueryClient();cache.setQueryData(billingReportKeys.client('other'),{a:1});cache.setQueryData(billingReportKeys.client(REPORT_CLIENT),{a:2});await clearPrivateClientScope(cache,REPORT_CLIENT);expect(cache.getQueryData(billingReportKeys.client(REPORT_CLIENT))).toBeUndefined();expect(cache.getQueryData(billingReportKeys.client('other'))).toEqual({a:1});await clearPrivateBillingQueries(cache);expect(cache.getQueryCache().getAll()).toHaveLength(0)
 })
 it('handles independent expense snapshots',async()=>{
  const page=parseProviderExpense(expenseFixture(),REPORT_CLIENT,REPORT_RANGE);const {t}=setup(vi.fn().mockResolvedValue(page),'expense');await t.refresh();expect(t.snapshot().page?.asOf).toBe('2026-10-09T14:01:00.654321Z');t.retire()
 })
 it('times out at 30 seconds, rejects late data and offers explicit recovery',async()=>{
  const pending=deferred<ReturnType<typeof credit>>();const {t,reader,cache}=setup(vi.fn(()=>pending.promise));const work=t.refresh();await vi.advanceTimersByTimeAsync(30000);await work;expect(t.snapshot().busy).toBe(false);expect(t.snapshot().error?.kind).toBe('transient');pending.resolve(credit());await Promise.resolve();expect(t.snapshot().page).toBeNull();expect(cache.getQueryCache().getAll()).toHaveLength(0);reader.mockResolvedValueOnce(credit());await t.refresh();expect(t.snapshot().page).not.toBeNull();t.retire()
 })
 it('honours rate-limit delay for both continuation and refresh without automatic retries',async()=>{
  const {t,reader}=setup();await t.refresh();reader.mockRejectedValueOnce({status:429,retryAfterSeconds:5});await t.more();await t.more();await t.refresh();expect(reader).toHaveBeenCalledTimes(2);await vi.advanceTimersByTimeAsync(5000);reader.mockResolvedValueOnce(credit(null,'02'));await t.more();expect(reader.mock.calls[2][3]).toBe('next');t.retire()
 })
 it('does not refetch on focus/reconnect or mutation invalidation',async()=>{
  const {t,cache,reader}=setup();await t.refresh();window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('online'));await cache.invalidateQueries({queryKey:billingReportKeys.all});expect(reader).toHaveBeenCalledTimes(1);t.retire()
 })

 it.each([503,429,'timeout'] as const)('preserves expiry after pending continuation fails (%s)',async status=>{
  const {t,reader}=setup();await t.refresh();vi.setSystemTime(new Date('2026-10-09T14:14:59Z'));await t.refresh()
  const pending=deferred<ReturnType<typeof credit>>();reader.mockReturnValueOnce(pending.promise);const work=t.more();await vi.advanceTimersByTimeAsync(2000);expect(t.snapshot().stale).toBe(true)
  if(status==='timeout')await vi.advanceTimersByTimeAsync(28000);else pending.reject({status,retryAfterSeconds:1});await work
  expect(t.snapshot().stale).toBe(true);expect(t.snapshot().page?.totals).toEqual(credit().totals);await t.more();expect(reader).toHaveBeenCalledTimes(3);t.retire()
 })

})

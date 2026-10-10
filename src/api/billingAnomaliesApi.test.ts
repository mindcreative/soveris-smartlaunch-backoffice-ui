import {describe,it,expect} from 'vitest'
import {serializeAnomalyCommand,parseAnomalyDetail} from './billingAnomaliesApi'
import {createUuidV7} from '../lib/uuidV7'
describe('lossless anomaly transport',()=>{
 it('keeps exact long revision bytes in commands',()=>{
  const body=serializeAnomalyCommand({operationId:createUuidV7(),expectedRevision:'9007199254740993',configVersion:createUuidV7(),configHash:'a'.repeat(64),action:'resolved',reason:' private reason '})
  expect(body).toContain('"expectedRevision":9007199254740993');expect(body).toContain('"reason":"private reason"')
 })
 it('rejects malformed or cross-scope evidence without rendering payload',()=>{
  expect(()=>parseAnomalyDetail('{"item":{"evidence":{"clientId":"other"}}}',createUuidV7(),createUuidV7())).toThrow()
 })
})

import {anomalyDetailFixture,anomalyHistoryMetadata,ANOMALY_ID} from '../test/billingAnomaliesFixture'
import {REPORT_CLIENT} from '../test/billingReportsFixture'
it('projects exact saved expense and workflow separately, rejecting cross-Client and unsafe routing',()=>{
 const raw=anomalyDetailFixture();const d=parseAnomalyDetail(raw,REPORT_CLIENT,ANOMALY_ID);expect(d.item.evidence.inputs.expense?.effectiveExpense).toBe('5.0000');expect(d.item.workflow.revision).toBe('0')
 expect(()=>parseAnomalyDetail(raw,createUuidV7(),ANOMALY_ID)).toThrow();expect(()=>parseAnomalyDetail(raw.replace('"destination":null','"destination":"https://example.test"'),REPORT_CLIENT,ANOMALY_ID)).toThrow()
})
import {anomalyItemFixture} from '../test/billingAnomaliesFixture'
it('keeps zero-grant and partial breach evidence distinct without reinterpreting a decision',()=>{
 const credit=anomalyItemFixture(REPORT_CLIENT,'credit_consumption_to_grants','0','not_applicable').replace('"grants":1000000000.0000','"grants":0.0000').replace('"outcome":"breached"','"outcome":"not_evaluable"').replace('exact_consumption_to_grants','zero_grants')
 const detail=parseAnomalyDetail(`{"item":${credit},"history":[],"nextHistoryCursor":null,"canTransition":false,${JSON.stringify(anomalyHistoryMetadata()).slice(1,-1)}}`,REPORT_CLIENT,ANOMALY_ID);expect(detail.item.evidence.inputs.grants).toBe('0.0000');expect(detail.item.evidence.inputs.consumption).toBe('1000000000.0001');expect(detail.item.evidence.decision.reason).toBe('zero_grants');expect(detail.item.workflow.status).toBe('not_applicable')
 const partial=anomalyDetailFixture().replace('"completeness":"complete"','"completeness":"partial"').replace('"reason":"effective_expense"','"reason":"incomplete_expense"').replace('"unknownCurrencyCount":0','"unknownCurrencyCount":1').replace('"totalObservationCount":2','"totalObservationCount":3')
 const saved=parseAnomalyDetail(partial,REPORT_CLIENT,ANOMALY_ID);expect(saved.item.evidence.decision.outcome).toBe('breached');expect(saved.item.evidence.decision.completeness).toBe('partial');expect(saved.item.evidence.inputs.expense?.effectiveExpense).toBe('5.0000')
})
it('uses the same NEL/BOM reason normalization as the server and rejects PostgreSQL NUL',()=>{
 const base={operationId:createUuidV7(),expectedRevision:'0',configVersion:createUuidV7(),configHash:'a'.repeat(64),action:'resolved' as const,reason:'\u0085reason\u0085'}
 expect(JSON.parse(serializeAnomalyCommand(base)).reason).toBe('reason')
 expect(JSON.parse(serializeAnomalyCommand({...base,reason:'\uFEFFreason\uFEFF'})).reason).toBe('\uFEFFreason\uFEFF')
 expect(()=>serializeAnomalyCommand({...base,reason:'reason\0'})).toThrow()
})
it('rejects gaps, state discontinuity and truncated end in operator history',()=>{
 const base=JSON.parse(anomalyDetailFixture(REPORT_CLIENT,'3','open'))
 const transition=(revision:number,beforeStatus:string,afterStatus:string)=>({operationId:createUuidV7(),actorId:REPORT_CLIENT,beforeStatus,afterStatus,beforeRevision:revision-1,revision,reason:'checked',at:'2026-10-10T00:00:00Z',correlationId:createUuidV7(),routeVersion:null})
 base.history=[transition(3,'resolved','open'),transition(2,'acknowledged','resolved'),transition(1,'open','acknowledged')]
 expect(parseAnomalyDetail(JSON.stringify(base),REPORT_CLIENT,ANOMALY_ID).history).toHaveLength(3)
 expect(()=>parseAnomalyDetail(JSON.stringify({...base,history:[base.history[0],base.history[2]]}),REPORT_CLIENT,ANOMALY_ID)).toThrow()
 expect(()=>parseAnomalyDetail(JSON.stringify({...base,history:[base.history[0]]}),REPORT_CLIENT,ANOMALY_ID)).toThrow()
 expect(()=>parseAnomalyDetail(JSON.stringify({...base,history:[]}),REPORT_CLIENT,ANOMALY_ID)).toThrow()
 const discontinuity=structuredClone(base);discontinuity.history[1].afterStatus='open'
 expect(()=>parseAnomalyDetail(JSON.stringify(discontinuity),REPORT_CLIENT,ANOMALY_ID)).toThrow()
})

it('history continuation accepts a newer current head but rejects an empty truncated final page',()=>{
 const raw=JSON.parse(anomalyDetailFixture(REPORT_CLIENT,'3','open'));raw.history=raw.history.slice(1);expect(parseAnomalyDetail(JSON.stringify(raw),REPORT_CLIENT,ANOMALY_ID,true).history).toHaveLength(2)
 expect(()=>parseAnomalyDetail(JSON.stringify({...raw,history:[]}),REPORT_CLIENT,ANOMALY_ID,true)).toThrow()
})

import type {ExpenseMetrics} from './billingReports'
export type AnomalySignal='provider_expense'|'credit_consumption_to_grants'
export type OperatorStatus='open'|'acknowledged'|'resolved'|'not_applicable'
export interface AnomalyFilters {
 from:string;to:string;signal:AnomalySignal|null;currency:string|null;configVersion:string|null;ruleKey:string|null;ruleVersion:number|null;
 outcome:'breached'|'not_breached'|'not_evaluable'|null;workflowStatus:OperatorStatus|null;owner:string|null;policy:'current'|'historical'|'all';pageSize:number
}
export interface AnomalyInputs {
 grants:string|null;consumption:string|null;creditProvenance:{ledgerEntryCount:string;usageRecordCount:string;unsettledUsageCount:string;unsettledUsageCredits:string;source:string;ledgerDateBasis:string;usageDateBasis:string;membership:string;netBasis:string;consumptionBasis:string}|null;
 expense:ExpenseMetrics|null;unknownCurrencyCount:string;unknownMissingAmountCount:string;totalObservationCount:string;emptyData:boolean
}
export interface AnomalyEvidence {
 evaluationId:string;clientId:string;configVersion:string;configHash:string;ruleKey:string;ruleVersion:number;ownerAlias:string;signal:AnomalySignal;units:'provider_money'|'ratio';currency:string|null;expenseBasis:'effective_expense'|'reconciled_provider_expense'|null;
 comparator:'gt'|'gte';threshold:string;scopeOrigin:'global'|'client_override';windowFrom:string;windowTo:string;capturedAt:string;asOf:string;inputs:AnomalyInputs;
 decision:{outcome:'breached'|'not_breached'|'not_evaluable';reason:string;completeness:'complete'|'partial'};algorithm:string;schemaVersion:1;sourceDateBasis:string;membership:string
}
export interface AnomalyRouting {state:'mapped'|'unmapped'|'unavailable';displayOwner:string|null;version:string|null;contentHash:string|null;destination:string|null;externalDelivery:'not_configured';reloadState:'valid'|'last_known_good'|'unavailable'}
export interface AnomalyItem {evidence:AnomalyEvidence;workflow:{status:OperatorStatus;revision:string};routing:AnomalyRouting;historical:boolean}
export interface AnomalyTransition {operationId:string;actorId:string;beforeStatus:OperatorStatus;afterStatus:OperatorStatus;beforeRevision:string;revision:string;reason:string|null;at:string;correlationId:string;routeVersion:string|null}
export interface AnomalyDetail {item:AnomalyItem;history:AnomalyTransition[];nextHistoryCursor:string|null;canTransition:boolean;historyAsOf:string;historyExpiresAt:string}
export interface AnomalyPage {clientId:string;filters:AnomalyFilters;asOf:string;policy:{version:string|null;state:'configured'|'disabled'|'not_configured'};items:AnomalyItem[];coverageGaps:{gapId:string;retiredVersion:string;supersedingVersion:string;ruleId:string;windowFrom:string;windowTo:string}[];moreCoverageGaps:boolean;nextCursor:string|null;canTransition:boolean}
export interface AnomalyCommand {operationId:string;expectedRevision:string;configVersion:string;configHash:string;action:'acknowledged'|'resolved'|'open';reason:string|null}
export interface AnomalyReceipt {clientId:string;evaluationId:string;operationId:string;actorId:string;beforeStatus:OperatorStatus;status:OperatorStatus;beforeRevision:string;revision:string;at:string;reason:string|null;configVersion:string;configHash:string;correlationId:string;routeVersion:string|null}

import type { ReportFilters, ReportKind } from '../types/billingReports'
export const billingReportKeys = {
  all: ['backoffice','private','billing','reports'] as const,
  client:(client:string)=>['backoffice','private','billing','reports',client] as const,
  page:(client:string,kind:ReportKind,filters:ReportFilters,authorityGeneration:number,traversal:number,request:number)=>[...billingReportKeys.client(client),kind,filters,authorityGeneration,traversal,request] as const,
}
// Cleanup fences local projections synchronously, before awaiting query cancellation.
const scopes=new Set<{client:string;kind:ReportKind;retire:()=>void}>()
export function registerReportScope(client:string,kind:ReportKind,retire:()=>void):()=>void {const scope={client,kind,retire};scopes.add(scope);return ()=>scopes.delete(scope)}
export function retireReportScopes(client?:string,kind?:ReportKind):void {for(const s of [...scopes])if((client===undefined||s.client===client)&&(kind===undefined||s.kind===kind))s.retire()}

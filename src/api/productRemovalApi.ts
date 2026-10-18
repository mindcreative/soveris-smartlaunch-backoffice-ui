import { apiClient } from './apiClient'
import { domainGuid } from './domainContracts'
import { localResponseBinding } from '../timezone/responseGuard'
import { parseRemovalPage,parseRemovalPreview,parseRemovalReceipt,removalPolicy,type RemovalCommand,RemovalContractError } from './productRemovalContracts'
const config=(client:string,signal?:AbortSignal)=>({signal,timeout:15000,headers:{'X-Product-Client-Id':domainGuid(client)},transformResponse:[(value:string)=>value],retryOnUnauthorized:false})
async function bound<T>(signal:AbortSignal|undefined,load:()=>Promise<T>){const binding=await localResponseBinding(signal);const result=await load();if(signal?.aborted)throw new DOMException('Aborted','AbortError');binding.verify(undefined);return result}
export const productRemovalApi={
 preview:(client:string,product:string,signal?:AbortSignal)=>bound(signal,async()=>{
  domainGuid(product);const response=await apiClient.get<string>(`/products/${product}/removal-preview`,config(client,signal));if(response.status!==200)throw new RemovalContractError();return parseRemovalPreview(response.data,client,product)
 }),
 remove:(client:string,product:string,command:RemovalCommand,signal?:AbortSignal)=>bound(signal,async()=>{
  domainGuid(product);domainGuid(command.operationId,true)
  if(command.policyVersion!==removalPolicy||!/^[1-9]\d*$/.test(command.expectedRevision)||BigInt(command.expectedRevision)>9223372036854775807n||!/^[a-f0-9]{64}$/.test(command.previewFingerprint))throw new RemovalContractError()
  const data=`{"operationId":${JSON.stringify(command.operationId)},"expectedRevision":${command.expectedRevision},"policyVersion":"product-removal-v1","previewFingerprint":${JSON.stringify(command.previewFingerprint)}}`
  const response=await apiClient.delete<string>(`/products/${product}`,{...config(client,signal),data,retryOnUnauthorized:false})
  if(response.status!==200)throw new RemovalContractError();const receipt=parseRemovalReceipt(response.data,client)
  if(receipt.productId!==product||receipt.operationId!==command.operationId||receipt.removedRevision!==command.expectedRevision)throw new RemovalContractError()
  return receipt
 }),
 status:(client:string,operation:string,signal?:AbortSignal)=>bound(signal,async()=>{
  domainGuid(operation,true);const response=await apiClient.get<string>(`/clients/${client}/product-removals/${operation}`,config(client,signal));if(response.status!==200)throw new RemovalContractError()
  const receipt=parseRemovalReceipt(response.data,client);if(receipt.operationId!==operation)throw new RemovalContractError();return receipt
 }),
 list:(client:string,page=1,product?:string,signal?:AbortSignal)=>bound(signal,async()=>{
  if(!Number.isSafeInteger(page)||page<1)throw new RemovalContractError();if(product)domainGuid(product)
  const response=await apiClient.get<string>(`/clients/${client}/product-removals?page=${page}&pageSize=20${product?`&productId=${product}`:''}`,config(client,signal));if(response.status!==200)throw new RemovalContractError();return parseRemovalPage(response.data,client)
 }),
}

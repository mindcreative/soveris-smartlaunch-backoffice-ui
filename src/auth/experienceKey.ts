import { currentAuthorityEpoch } from './authorityEpoch'
let scope='unbound'
export const setExperienceKey=(next:string)=>{scope=next}
export const privateExperienceKey=()=>['experience',scope,currentAuthorityEpoch()] as const
export const withExperienceKey=(key:readonly unknown[])=>[...key,...privateExperienceKey()] as const

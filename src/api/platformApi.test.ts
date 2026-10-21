import { expect,it } from 'vitest'
import { parsePlatformClient } from './platformApi'
const target='01990000-0000-7000-8000-000000000002'
const data={id:target,name:'Authorized Client',status:1,clientClassification:'customer',classificationRevision:0,createdAt:'2026-10-21T00:00:00Z'}
it('keeps the metadata allowlist and lossless revision; rejects extra content and target mismatches',()=>{
  expect(parsePlatformClient(JSON.stringify(data).replace('"classificationRevision":0','"classificationRevision":9007199254740993'),target).classificationRevision).toBe('9007199254740993')
  for(const row of [{...data,privateContent:'private-canary'},{...data,id:'01990000-0000-7000-8000-000000000099'},{...data,classificationRevision:-1},{...data,name:null},{...data,clientClassification:'Admin'}])expect(()=>parsePlatformClient(JSON.stringify(row),target)).toThrow()
})

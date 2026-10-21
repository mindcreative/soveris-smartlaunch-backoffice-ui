import { expect,it } from 'vitest'
import { appearanceSubject } from './sessionHint'
const id='01990000-0000-7000-8000-000000000001'
const token=(payload:unknown)=>'e30.'+btoa(JSON.stringify(payload)).replace(/=+$/,'')+'.c2ln'
it('uses only a bounded untrusted subject while presentation restore is pending',()=>{
  expect(appearanceSubject(token({sub:id,exp:2000,role:'Admin',permissions:['*']}),1000)).toBe(id)
  for(const value of ['',null,'a.b.c', 'a'.repeat(8193),token({sub:'other',exp:2000}),token({sub:id,exp:1000}),token({sub:id}),token({sub:id,exp:'2000'})])
    expect(appearanceSubject(value,1000)).toBeNull()
})

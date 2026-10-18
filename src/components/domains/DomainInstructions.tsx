import { useEffect, useRef, useState } from 'react'
import type { Domain, DomainRecord, DomainRoutingRecord } from '../../types/domains'
import { LocalInstant } from '../../timezone/LocalInstant'
import { domainButton } from './DomainClaimModal'

const dnsMessages: Record<string, string> = {
  dns_nxdomain: 'The DNS name was not found. Check the complete record and allow propagation.',
  dns_no_data: 'No matching DNS record was returned. Keep the instructions while DNS propagates.',
  dns_mismatch: 'The DNS record does not match the expected proof. Compare its complete value.',
  dns_timeout: 'The DNS check timed out. This does not prove the record is wrong.',
  dns_servfail: 'DNS temporarily failed. The last check could not confirm ownership.',
  dns_provider_failure: 'The DNS check is temporarily unavailable. Keep the existing records.',
}
export function DomainTime({ label, value }: { label: string; value: string | null }) {
  return <div className="min-w-0"><dt className="font-medium text-foreground">{label}</dt><dd className="break-words text-foreground">{value ? <LocalInstant value={value} /> : 'Not supplied'}</dd></div>
}
function RecordView({ record, label }: { record: DomainRecord | DomainRoutingRecord; label: string }) {
  const text = `${record.type} ${record.name} ${record.value} TTL ${record.ttlSeconds}`
  const [message, setMessage] = useState('')
  const alive = useRef(true), sequence = useRef(0), fallback = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { alive.current = true; return () => { alive.current = false; sequence.current++ } }, [])
  const copy = async () => {
    const attempt = ++sequence.current
    try {
      await navigator.clipboard.writeText(text)
      if (alive.current && attempt === sequence.current) setMessage(`${label} copied.`)
    } catch {
      if (alive.current && attempt === sequence.current) setMessage('Copy unavailable. Select the record text below and copy it.')
    }
  }
  return <article className="min-w-0 space-y-3 rounded-md border border-control p-4">
    <h3 className="font-semibold">{label}</h3>
    <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-2">
      <div><dt>Type</dt><dd className="font-mono">{record.type}</dd></div>
      <div><dt>TTL (seconds)</dt><dd>{record.ttlSeconds}</dd></div>
      <div className="min-w-0 sm:col-span-2"><dt>Name</dt><dd className="break-all font-mono">{record.name}</dd></div>
      {record.relativeName !== null && <div className="min-w-0 sm:col-span-2"><dt>Relative name supplied by server</dt><dd className="break-all font-mono">{record.relativeName}</dd></div>}
      <div className="min-w-0 sm:col-span-2"><dt>Value</dt><dd className="break-all font-mono">{record.value}</dd></div>
      {'managedBy' in record && <div><dt>Managed by</dt><dd>{record.managedBy === 'soveris' ? 'Soveris — keep this managed record' : 'Client — configure with your DNS provider'}</dd></div>}
    </dl>
    <div className="flex flex-wrap gap-2"><button type="button" className={domainButton} onClick={() => void copy()}>Copy {label.toLowerCase()}</button><button type="button" className={domainButton} onClick={() => { fallback.current?.focus(); fallback.current?.select() }}>Select {label.toLowerCase()} text</button></div>
    <p role="status" className="min-h-6 text-sm text-foreground">{message}</p>
    <label className="block text-sm">{label} text<textarea ref={fallback} readOnly value={text} rows={3} className="mt-1 w-full min-w-0 resize-y rounded-md border border-control p-2 font-mono text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" /></label>
  </article>
}
export function DomainInstructions({ domain }: { domain: Domain }) {
  const check = domain.verification
  return <section aria-labelledby="domain-dns-heading" className="min-w-0 space-y-4">
    <h2 id="domain-dns-heading" className="text-lg font-semibold">DNS instructions and check history</h2>
    <p className="text-sm text-foreground">Ownership proof, traffic routing and TLS are separate. Keep the exact record values, including trailing dots. TXT proves ownership; it does not establish apex routing. Configure routing separately using a record type supported by your provider.</p>
    <RecordView key={`${domain.id}:${check.generation}:ownership`} record={check.record} label="Ownership record" />
    <h3 className="font-semibold">Routing records</h3>
    {domain.routing.records.length === 0 ? <p>No routing instructions were supplied. Do not assume routing is configured.</p> : domain.routing.records.map((record, i) => <RecordView key={`${domain.id}:${check.generation}:routing:${i}`} record={record} label={`Routing record ${i + 1}`} />)}
    {check.lastErrorCode && <p className="rounded-md border border-warning-line bg-warning-soft p-3 text-sm text-warning">{dnsMessages[check.lastErrorCode]}</p>}
    <dl className="grid min-w-0 gap-4 text-sm sm:grid-cols-2">
      <DomainTime label="Last check" value={check.lastCheckedAt} /><DomainTime label="Next DNS check (server schedule)" value={check.nextCheckAt} />
      <DomainTime label="Campaign deadline" value={check.deadlineAt} /><DomainTime label="Persisted Verify cooldown until" value={check.cooldownUntil} />
      <DomainTime label="Ownership verified at" value={domain.ownership.verifiedAt} /><DomainTime label="Ownership proof expires" value={domain.ownership.validUntil} />
      <DomainTime label="TLS expires" value={domain.tls.validUntil} /><DomainTime label="Edge next action" value={domain.edge?.nextActionAt ?? null} />
    </dl>
    <p className="text-sm text-foreground">Times use your saved timezone and preserve microseconds. Scheduled timestamps are display context; cooldown and request-rate waits come from separate server timing. Five minutes of UI tracking is not a verification failure deadline.</p>
    {domain.edge && <p className="break-words text-sm text-foreground">Edge {domain.edge.workKind}: {domain.edge.state}; attempts {domain.edge.attemptCount}.{domain.edge.lastErrorCode ? ` Recovery: ${domain.edge.lastErrorCode.replace(/_/g, ' ')}. Routing and TLS still require current confirmation.` : ''} No separate edge-activation or edge-Retry action is available.</p>}
  </section>
}

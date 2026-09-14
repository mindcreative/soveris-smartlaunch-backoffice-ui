import type { ProductContentValidationIssue, ProductContentV1 } from '../../types/content'
import { issueMessage, pointerToFieldId } from './productEditorModel'

interface EditableLink { label: string; href: string }
interface EditableImage { src: string; alt: string }
interface EditableFeature { title: string; description: string; image?: EditableImage }
interface EditableQuestion { question: string; answer: string }
interface EditableFooterLink { name: string; href: string }
interface EditableFooter { heading: string; links: EditableFooterLink[] }
interface EditableFormField {
  type: 'string' | 'array'; title: string; order: number; format?: 'email'; 'ui:widget'?: 'textarea' | 'radio' | 'checkbox'
  minLength?: number; maxLength?: number; enum?: string[]; 'ui:enumLabels'?: Record<string, string>
  items?: { type: 'string'; enum: string[] }; uniqueItems?: true; minItems?: number; maxItems?: number
  'ui:exclusionGroups'?: Record<string, string[]>
}
interface EditableContent {
  slug: string; name: string
  hero: { title: string; subtitle: string; cta: EditableLink; secondaryCta?: EditableLink; backgroundImage: EditableImage; trustText?: string }
  features?: { heading: string; description?: string; items: EditableFeature[] }
  questions?: { heading: string; description?: string; items: EditableQuestion[] }
  form?: { title: string; description?: string; submitLabel: string; schema: { type: 'object'; properties: Record<string, EditableFormField>; required?: string[]; additionalProperties: false } }
  footer?: EditableFooter[]
  seo?: { metaTitle?: string; metaDescription?: string }
}

interface ProductContentFieldsProps {
  value: ProductContentV1
  errors: ProductContentValidationIssue[]
  disabled?: boolean
  onChange: (value: ProductContentV1, pointer: string) => void
  onBlur: (pointer: string) => void
}

function Input({ label, path, value, errors, disabled, multiline, type = 'text', min, max, onChange, onBlur }: {
  label: string; path: string; value: string | number; errors: ProductContentValidationIssue[]; disabled?: boolean
  multiline?: boolean; type?: 'text' | 'number' | 'url'; min?: number; max?: number
  onChange: (value: string) => void; onBlur: () => void
}) {
  const error = errors.find((issue) => issue.path === path)
  const id = pointerToFieldId(path)
  const errorId = `${id}-error`
  const classes = `mt-1 min-h-11 w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 ${error ? 'border-red-600' : 'border-gray-300'}`
  const common = { id, value, disabled, 'aria-invalid': error ? true : undefined, 'aria-describedby': error ? errorId : undefined, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value), onBlur, className: classes }
  return <div><label htmlFor={id} className="block text-sm font-medium text-gray-900">{label}</label>{multiline ? <textarea {...common} rows={3} maxLength={max} /> : <input {...common} type={type} min={min} max={max} maxLength={type === 'number' ? undefined : max} />}{error && <p id={errorId} className="mt-1 text-sm text-red-800">{issueMessage(error)}</p>}</div>
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <fieldset className="space-y-4 rounded-lg border border-gray-300 p-4"><legend className="px-1 font-semibold text-gray-950">{title}</legend>{children}</fieldset>
}

function profile(field: EditableFormField): string {
  if (field.type === 'array') return 'checkbox'
  if (field.format === 'email') return 'email'
  return field['ui:widget'] ?? (field.enum ? 'select' : 'text')
}

function newField(kind: string, order: number): EditableFormField {
  const base = { type: 'string' as const, title: 'New field', order, maxLength: 120 }
  if (kind === 'email') return { ...base, format: 'email' }
  if (kind === 'textarea') return { ...base, 'ui:widget': 'textarea', maxLength: 2000 }
  if (kind === 'select') return { ...base, enum: ['option'] }
  if (kind === 'radio') return { ...base, 'ui:widget': 'radio', enum: ['option'] }
  if (kind === 'checkbox') return { type: 'array', title: 'New field', order, 'ui:widget': 'checkbox', items: { type: 'string', enum: ['option'] }, uniqueItems: true, maxItems: 1 }
  return base
}

function parseLines(value: string): string[] { return value.split('\n').map((item) => item.trim()).filter(Boolean) }
function labelsText(labels?: Record<string, string>): string { return labels ? Object.entries(labels).map(([key, label]) => `${key}=${label}`).join('\n') : '' }
function parseLabels(value: string): Record<string, string> | undefined {
  const entries = parseLines(value).map((line) => { const split = line.indexOf('='); return split > 0 ? [line.slice(0, split).trim(), line.slice(split + 1).trim()] : null }).filter((entry): entry is [string, string] => Boolean(entry?.[0] && entry[1]))
  return entries.length ? Object.fromEntries(entries) : undefined
}
function groupsText(groups?: Record<string, string[]>): string { return groups ? Object.entries(groups).map(([key, values]) => `${key}=${values.join(',')}`).join('\n') : '' }
function parseGroups(value: string): Record<string, string[]> | undefined {
  const entries = parseLines(value).map((line) => { const split = line.indexOf('='); return split > 0 ? [line.slice(0, split).trim(), line.slice(split + 1).split(',').map((item) => item.trim()).filter(Boolean)] : null }).filter((entry): entry is [string, string[]] => Boolean(entry?.[0] && entry[1].length))
  return entries.length ? Object.fromEntries(entries) : undefined
}

export function ProductContentFields({ value, errors, disabled, onChange, onBlur }: ProductContentFieldsProps) {
  const content = value as unknown as EditableContent
  const update = (pointer: string, mutate: (draft: EditableContent) => void) => {
    const draft = structuredClone(content)
    mutate(draft)
    onChange(draft as unknown as ProductContentV1, pointer)
  }
  const field = (label: string, path: string, current: string | number, set: (draft: EditableContent, value: string) => void, options: Partial<Parameters<typeof Input>[0]> = {}) => <Input label={label} path={path} value={current} errors={errors} disabled={disabled} onChange={(next) => update(path, (draft) => set(draft, next))} onBlur={() => onBlur(path)} {...options} />
  const buttonClass = 'min-h-11 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:opacity-50'

  return <div className="space-y-5">
    <Section title="Hero">
      {field('Hero title', '/hero/title', content.hero.title, (draft, next) => { draft.hero.title = next }, { max: 120 })}
      {field('Hero subtitle', '/hero/subtitle', content.hero.subtitle, (draft, next) => { draft.hero.subtitle = next }, { max: 500, multiline: true })}
      <div className="grid gap-4 sm:grid-cols-2">{field('Primary action label', '/hero/cta/label', content.hero.cta.label, (draft, next) => { draft.hero.cta.label = next }, { max: 120 })}{field('Primary action URL', '/hero/cta/href', content.hero.cta.href, (draft, next) => { draft.hero.cta.href = next }, { max: 2048, type: 'url' })}</div>
      <div className="grid gap-4 sm:grid-cols-2">{field('Background image path', '/hero/backgroundImage/src', content.hero.backgroundImage.src, (draft, next) => { draft.hero.backgroundImage.src = next }, { max: 2048 })}{field('Background image alternative text', '/hero/backgroundImage/alt', content.hero.backgroundImage.alt, (draft, next) => { draft.hero.backgroundImage.alt = next }, { max: 120 })}</div>
      {content.hero.secondaryCta ? <div className="space-y-3 rounded-md bg-gray-50 p-3"><div className="grid gap-4 sm:grid-cols-2">{field('Secondary action label', '/hero/secondaryCta/label', content.hero.secondaryCta.label, (draft, next) => { draft.hero.secondaryCta!.label = next }, { max: 120 })}{field('Secondary action URL', '/hero/secondaryCta/href', content.hero.secondaryCta.href, (draft, next) => { draft.hero.secondaryCta!.href = next }, { max: 2048 })}</div><button type="button" disabled={disabled} onClick={() => update('/hero/secondaryCta', (draft) => { delete draft.hero.secondaryCta })} className={buttonClass}>Remove secondary action</button></div> : <button id={pointerToFieldId('/hero/secondaryCta')} type="button" disabled={disabled} onClick={() => update('/hero/secondaryCta', (draft) => { draft.hero.secondaryCta = { label: '', href: '' } })} className={buttonClass}>Add secondary action</button>}
      {content.hero.trustText !== undefined ? <div className="space-y-2">{field('Trust text', '/hero/trustText', content.hero.trustText, (draft, next) => { draft.hero.trustText = next }, { max: 500 })}<button type="button" disabled={disabled} onClick={() => update('/hero/trustText', (draft) => { delete draft.hero.trustText })} className={buttonClass}>Remove trust text</button></div> : <button id={pointerToFieldId('/hero/trustText')} type="button" disabled={disabled} onClick={() => update('/hero/trustText', (draft) => { draft.hero.trustText = '' })} className={buttonClass}>Add trust text</button>}
    </Section>

    <Section title="Features (optional)">
      {!content.features ? <button id={pointerToFieldId('/features')} type="button" disabled={disabled} onClick={() => update('/features', (draft) => { draft.features = { heading: '', items: [] } })} className={buttonClass}>Add Features section</button> : <>{field('Features heading', '/features/heading', content.features.heading, (draft, next) => { draft.features!.heading = next }, { max: 120 })}{content.features.description !== undefined ? field('Features description', '/features/description', content.features.description, (draft, next) => { draft.features!.description = next }, { max: 500, multiline: true }) : <button type="button" disabled={disabled} onClick={() => update('/features/description', (draft) => { draft.features!.description = '' })} className={buttonClass}>Add Features description</button>}
        {content.features.items.map((item, index) => { const base = `/features/items/${index}`; return <div key={index} className="space-y-3 rounded-md border border-gray-200 p-3"><h4 className="font-medium">Feature {index + 1}</h4>{field('Feature title', `${base}/title`, item.title, (draft, next) => { draft.features!.items[index]!.title = next }, { max: 120 })}{field('Feature description', `${base}/description`, item.description, (draft, next) => { draft.features!.items[index]!.description = next }, { max: 500, multiline: true })}{item.image ? <><div className="grid gap-4 sm:grid-cols-2">{field('Feature image path', `${base}/image/src`, item.image.src, (draft, next) => { draft.features!.items[index]!.image!.src = next }, { max: 2048 })}{field('Feature image alternative text', `${base}/image/alt`, item.image.alt, (draft, next) => { draft.features!.items[index]!.image!.alt = next }, { max: 120 })}</div><button type="button" disabled={disabled} onClick={() => update(`${base}/image`, (draft) => { delete draft.features!.items[index]!.image })} className={buttonClass}>Remove feature image</button></> : <button id={pointerToFieldId(`${base}/image`)} type="button" disabled={disabled} onClick={() => update(`${base}/image`, (draft) => { draft.features!.items[index]!.image = { src: '', alt: '' } })} className={buttonClass}>Add feature image</button>}<button type="button" disabled={disabled} onClick={() => update(base, (draft) => { draft.features!.items.splice(index, 1) })} className={buttonClass}>Remove feature {index + 1}</button></div> })}
        <div className="flex flex-wrap gap-2"><button id={pointerToFieldId('/features/items')} type="button" disabled={disabled || content.features.items.length >= 12} onClick={() => update('/features/items', (draft) => { draft.features!.items.push({ title: '', description: '' }) })} className={buttonClass}>Add feature</button><button type="button" disabled={disabled} onClick={() => update('/features', (draft) => { delete draft.features })} className={buttonClass}>Remove Features section</button></div>
      </>}
    </Section>

    <Section title="Questions (optional)">
      {!content.questions ? <button id={pointerToFieldId('/questions')} type="button" disabled={disabled} onClick={() => update('/questions', (draft) => { draft.questions = { heading: '', items: [] } })} className={buttonClass}>Add Questions section</button> : <>{field('Questions heading', '/questions/heading', content.questions.heading, (draft, next) => { draft.questions!.heading = next }, { max: 120 })}{content.questions.description !== undefined ? field('Questions description', '/questions/description', content.questions.description, (draft, next) => { draft.questions!.description = next }, { max: 500, multiline: true }) : <button type="button" disabled={disabled} onClick={() => update('/questions/description', (draft) => { draft.questions!.description = '' })} className={buttonClass}>Add Questions description</button>}
        {content.questions.items.map((item, index) => { const base = `/questions/items/${index}`; return <div key={index} className="space-y-3 rounded-md border border-gray-200 p-3">{field(`Question ${index + 1}`, `${base}/question`, item.question, (draft, next) => { draft.questions!.items[index]!.question = next }, { max: 120 })}{field('Answer', `${base}/answer`, item.answer, (draft, next) => { draft.questions!.items[index]!.answer = next }, { max: 2000, multiline: true })}<button type="button" disabled={disabled} onClick={() => update(base, (draft) => { draft.questions!.items.splice(index, 1) })} className={buttonClass}>Remove question {index + 1}</button></div> })}
        <div className="flex flex-wrap gap-2"><button id={pointerToFieldId('/questions/items')} type="button" disabled={disabled || content.questions.items.length >= 20} onClick={() => update('/questions/items', (draft) => { draft.questions!.items.push({ question: '', answer: '' }) })} className={buttonClass}>Add question</button><button type="button" disabled={disabled} onClick={() => update('/questions', (draft) => { delete draft.questions })} className={buttonClass}>Remove Questions section</button></div>
      </>}
    </Section>

    <Section title="Form (required to publish)">
      {!content.form ? <button id={pointerToFieldId('/form')} type="button" disabled={disabled} onClick={() => update('/form', (draft) => { draft.form = { title: '', submitLabel: '', schema: { type: 'object', properties: {}, additionalProperties: false } } })} className={buttonClass}>Add Form section</button> : <>{field('Form title', '/form/title', content.form.title, (draft, next) => { draft.form!.title = next }, { max: 120 })}{content.form.description !== undefined ? field('Form description', '/form/description', content.form.description, (draft, next) => { draft.form!.description = next }, { max: 500, multiline: true }) : <button type="button" disabled={disabled} onClick={() => update('/form/description', (draft) => { draft.form!.description = '' })} className={buttonClass}>Add Form description</button>}{field('Submit button label', '/form/submitLabel', content.form.submitLabel, (draft, next) => { draft.form!.submitLabel = next }, { max: 120 })}
        {Object.entries(content.form.schema.properties).sort(([, a], [, b]) => a.order - b.order).map(([name, formField]) => { const escaped = name.replace(/~/g, '~0').replace(/\//g, '~1'); const base = `/form/schema/properties/${escaped}`; const kind = profile(formField); const enumValues = formField.type === 'array' ? formField.items?.enum ?? [] : formField.enum ?? []; return <div key={name} className="space-y-3 rounded-md border border-gray-200 p-3"><h4 className="font-medium">Form field: {name}</h4>
          {field('Field name', `${base}/name`, name, (draft, next) => { const current = draft.form!.schema.properties[name]!; delete draft.form!.schema.properties[name]; draft.form!.schema.properties[next] = current; draft.form!.schema.required = draft.form!.schema.required?.map((required) => required === name ? next : required) })}
          <div><label htmlFor={pointerToFieldId(base)} className="block text-sm font-medium text-gray-900">Field profile</label><select id={pointerToFieldId(base)} value={kind} disabled={disabled} onChange={(event) => update(base, (draft) => { draft.form!.schema.properties[name] = newField(event.target.value, formField.order) })} onBlur={() => onBlur(base)} className="mt-1 min-h-11 w-full rounded-md border border-gray-300 px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"><option value="text">Text</option><option value="email">Email</option><option value="textarea">Textarea</option><option value="select">Select</option><option value="radio">Radio</option><option value="checkbox">Checkbox</option></select></div>
          {field('Field label', `${base}/title`, formField.title, (draft, next) => { draft.form!.schema.properties[name]!.title = next }, { max: 120 })}{field('Field order', `${base}/order`, formField.order, (draft, next) => { draft.form!.schema.properties[name]!.order = Number(next) }, { type: 'number', min: 1, max: 20 })}
          {formField.type === 'string' ? <div className="grid gap-4 sm:grid-cols-2">{field('Minimum length (optional)', `${base}/minLength`, formField.minLength ?? '', (draft, next) => { if (next === '') delete draft.form!.schema.properties[name]!.minLength; else draft.form!.schema.properties[name]!.minLength = Number(next) }, { type: 'number', min: 0, max: formField.maxLength })}{field('Maximum length', `${base}/maxLength`, formField.maxLength ?? 120, (draft, next) => { draft.form!.schema.properties[name]!.maxLength = Number(next) }, { type: 'number', min: 1, max: kind === 'textarea' ? 2000 : 500 })}</div> : <div className="grid gap-4 sm:grid-cols-2">{field('Minimum selections (optional)', `${base}/minItems`, formField.minItems ?? '', (draft, next) => { if (next === '') delete draft.form!.schema.properties[name]!.minItems; else draft.form!.schema.properties[name]!.minItems = Number(next) }, { type: 'number', min: 0, max: 20 })}{field('Maximum selections', `${base}/maxItems`, formField.maxItems ?? 1, (draft, next) => { draft.form!.schema.properties[name]!.maxItems = Number(next) }, { type: 'number', min: 1, max: 20 })}</div>}
          {['select', 'radio', 'checkbox'].includes(kind) && <>{field('Options (one identifier per line)', `${base}/${formField.type === 'array' ? 'items/enum' : 'enum'}`, enumValues.join('\n'), (draft, next) => { const target = draft.form!.schema.properties[name]!; if (target.type === 'array') target.items!.enum = parseLines(next); else target.enum = parseLines(next) }, { multiline: true })}{field('Option labels (optional, option=Label)', `${base}/ui:enumLabels`, labelsText(formField['ui:enumLabels']), (draft, next) => { const labels = parseLabels(next); const target = draft.form!.schema.properties[name]!; if (labels) target['ui:enumLabels'] = labels; else delete target['ui:enumLabels'] }, { multiline: true })}</>}
          {kind === 'checkbox' && field('Exclusion groups (optional, group=option1,option2)', `${base}/ui:exclusionGroups`, groupsText(formField['ui:exclusionGroups']), (draft, next) => { const groups = parseGroups(next); const target = draft.form!.schema.properties[name]!; if (groups) target['ui:exclusionGroups'] = groups; else delete target['ui:exclusionGroups'] }, { multiline: true })}
          <label className="flex min-h-11 items-center gap-2 text-sm font-medium"><input type="checkbox" checked={content.form!.schema.required?.includes(name) ?? false} disabled={disabled} onChange={(event) => update('/form/schema/required', (draft) => { const required = new Set(draft.form!.schema.required ?? []); if (event.target.checked) required.add(name); else required.delete(name); const values = [...required]; if (values.length) draft.form!.schema.required = values; else delete draft.form!.schema.required })} className="h-5 w-5" />Required field</label>
          <button type="button" disabled={disabled} onClick={() => update(base, (draft) => { delete draft.form!.schema.properties[name]; const required = draft.form!.schema.required?.filter((item) => item !== name); if (required?.length) draft.form!.schema.required = required; else delete draft.form!.schema.required })} className={buttonClass}>Remove field {name}</button>
        </div> })}
        <div className="flex flex-wrap gap-2"><button id={pointerToFieldId('/form/schema/properties')} type="button" disabled={disabled || Object.keys(content.form.schema.properties).length >= 20} onClick={() => update('/form/schema/properties', (draft) => { const used = draft.form!.schema.properties; let suffix = Object.keys(used).length + 1; let name = `field${suffix}`; while (used[name]) { suffix += 1; name = `field${suffix}` } used[name] = newField('text', Object.keys(used).length + 1) })} className={buttonClass}>Add form field</button><button type="button" disabled={disabled} onClick={() => update('/form', (draft) => { delete draft.form })} className={buttonClass}>Remove Form section</button></div>
      </>}
    </Section>

    <Section title="Footer (optional)">
      {!content.footer ? <button id={pointerToFieldId('/footer')} type="button" disabled={disabled} onClick={() => update('/footer', (draft) => { draft.footer = [{ heading: '', links: [] }] })} className={buttonClass}>Add Footer</button> : <>{content.footer.map((section, sectionIndex) => { const base = `/footer/${sectionIndex}`; return <div key={sectionIndex} className="space-y-3 rounded-md border border-gray-200 p-3">{field(`Footer section ${sectionIndex + 1} heading`, `${base}/heading`, section.heading, (draft, next) => { draft.footer![sectionIndex]!.heading = next }, { max: 120 })}{section.links.map((link, linkIndex) => <div key={linkIndex} className="grid gap-3 rounded bg-gray-50 p-3 sm:grid-cols-2">{field('Footer link name', `${base}/links/${linkIndex}/name`, link.name, (draft, next) => { draft.footer![sectionIndex]!.links[linkIndex]!.name = next }, { max: 120 })}{field('Footer link URL', `${base}/links/${linkIndex}/href`, link.href, (draft, next) => { draft.footer![sectionIndex]!.links[linkIndex]!.href = next }, { max: 2048 })}<button type="button" disabled={disabled} onClick={() => update(`${base}/links/${linkIndex}`, (draft) => { draft.footer![sectionIndex]!.links.splice(linkIndex, 1) })} className={buttonClass}>Remove footer link {linkIndex + 1}</button></div>)}<button id={pointerToFieldId(`${base}/links`)} type="button" disabled={disabled || section.links.length >= 8} onClick={() => update(`${base}/links`, (draft) => { draft.footer![sectionIndex]!.links.push({ name: '', href: '' }) })} className={buttonClass}>Add footer link</button><button type="button" disabled={disabled} onClick={() => update(base, (draft) => { draft.footer!.splice(sectionIndex, 1) })} className={buttonClass}>Remove footer section {sectionIndex + 1}</button></div> })}<div className="flex flex-wrap gap-2"><button type="button" disabled={disabled || content.footer.length >= 4} onClick={() => update('/footer', (draft) => { draft.footer!.push({ heading: '', links: [] }) })} className={buttonClass}>Add footer section</button><button type="button" disabled={disabled} onClick={() => update('/footer', (draft) => { delete draft.footer })} className={buttonClass}>Remove Footer</button></div></>}
    </Section>

    <Section title="SEO (optional)">
      {!content.seo ? <button id={pointerToFieldId('/seo')} type="button" disabled={disabled} onClick={() => update('/seo', (draft) => { draft.seo = {} })} className={buttonClass}>Add SEO</button> : <>{content.seo.metaTitle !== undefined ? field('Meta title', '/seo/metaTitle', content.seo.metaTitle, (draft, next) => { draft.seo!.metaTitle = next }, { max: 120 }) : <button type="button" disabled={disabled} onClick={() => update('/seo/metaTitle', (draft) => { draft.seo!.metaTitle = '' })} className={buttonClass}>Add meta title</button>}{content.seo.metaDescription !== undefined ? field('Meta description', '/seo/metaDescription', content.seo.metaDescription, (draft, next) => { draft.seo!.metaDescription = next }, { max: 500, multiline: true }) : <button type="button" disabled={disabled} onClick={() => update('/seo/metaDescription', (draft) => { draft.seo!.metaDescription = '' })} className={buttonClass}>Add meta description</button>}<button type="button" disabled={disabled} onClick={() => update('/seo', (draft) => { delete draft.seo })} className={buttonClass}>Remove SEO</button></>}
    </Section>
  </div>
}

import type { FullResult, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter'
import { writeFileSync } from 'node:fs'

export default class AccountPrivacyReporter implements Reporter {
  private _selected = 0
  private _cases: { title: string; status: string; duration: number; location: { file: string; line: number; column: number }; failures: string[] }[] = []

  onBegin(_configuration: unknown, suite: Suite): void {
    this._selected = suite.allTests().length
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    // Error messages, stacks, locator snapshots, stdout and attachments can
    // contain live credentials. Keep the case, source location and disposition.
    const failures = test.annotations.filter(annotation => annotation.type === 'private-failure-location')
      .map(annotation => annotation.description ?? 'private assertion')
    this._cases.push({ title: test.title, status: result.status, duration: result.duration, location: test.location, failures })
  }

  onEnd(result: FullResult): void {
    const passed = this._cases.filter(test => test.status === 'passed').length
    const skipped = this._cases.filter(test => test.status === 'skipped').length
    const failed = this._cases.length - passed - skipped
    const summary = { selected: this._selected, passed, failed, skipped, status: result.status, cases: this._cases }

    if (process.env.ACCOUNT_JOURNEYS_RESULTS) {
      writeFileSync(process.env.ACCOUNT_JOURNEYS_RESULTS, JSON.stringify(summary, null, 2) + '\n')
    }

    process.stdout.write(`Account browser: ${passed}/${this._selected} passed; failures=${failed}; skipped=${skipped}.\n`)
  }
}

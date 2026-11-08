import { createUuidV7 } from '../lib/uuidV7'
import { supportAuthority } from './authority'
import { executeSupportCommand } from './pendingCommands'
import { supportFailure, SupportAccessError, SupportScopeChangedError } from './errors'
import { exitSupportLocally, retireSupport } from './lifetime'

/** One explicit terminal attempt after local retirement; no automatic replay. */
export function endSupportRequest(grant: string, revision: string, confirmed: () => void): void {
  const command = { operationId: createUuidV7(), expectedRevision: revision }
  exitSupportLocally(grant)
  const original = supportAuthority.capture()
  void executeSupportCommand('exit', command, grant).then(result => {
    if (!original.isCurrent()) {
      return
    }

    if (result.state !== 'ended') {
      throw new SupportAccessError(503)
    }

    confirmed()
  }).catch(error => {
    if (original.isCurrent() && !(error instanceof SupportScopeChangedError)) {
      retireSupport(supportFailure(error).notice)
    }
  })
}

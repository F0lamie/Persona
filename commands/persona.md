---
description: Choisir la persona de Claude (list, <nom>, random, off, reset --project)
argument-hint: "[list | <nom> | random | open-space | off | reset | new <nom> | check [nom]] [--project]"
allowed-tools: Bash(bash "${CLAUDE_PLUGIN_ROOT}/scripts/persona.sh":*)
disable-model-invocation: true
shell: bash
---

Résultat de la commande `/persona $ARGUMENTS` :

!`bash "${CLAUDE_PLUGIN_ROOT}/scripts/persona.sh" $ARGUMENTS`

## Ce que tu dois faire

- Si le résultat contient `PERSONA_ACTIVATED` : adopte immédiatement la persona décrite ci-dessus, en respectant son cadre, pour toute la suite de la session. Réponds par une courte phrase de confirmation, déjà dans le ton de la persona. Elle sera rechargée automatiquement aux prochaines sessions.
- Si le résultat contient `PERSONA_DEACTIVATED` : abandonne toute persona adoptée plus tôt dans la session et reprends ton ton habituel. Confirme en une phrase sobre. Si un avertissement indique qu'une autre persona reste active, adopte plutôt celle-là et signale-le.
- Sinon (liste, persona inconnue) : affiche le résultat tel quel, sans le commenter.

N'utilise aucun autre outil pour cette commande.

# personas

Une bibliothèque de personas pour Claude Code. `/persona` en charge une dans le contexte de la session, **sans modifier CLAUDE.md**.

## Installation

```
/plugin marketplace add F0lamie/Persona
/plugin install personas@claude-personas
```

## Utilisation

`/persona` sans argument ouvre un menu, comme `/plugin` :

- `↑` `↓` pour choisir, `Entrée` pour valider, `Échap` pour fermer ;
- `r` choisit le mode aléatoire, `o` aucune persona ;
- `t` bascule la portée entre global et projet ;
- un encadré affiche le début de la persona sélectionnée.

Le menu passe par l'API des mods de Claude Code. Sans elle, utilisez `/personas:persona <argument>`, qui marche partout avec les mêmes arguments.

Avec un argument, `/persona` agit sans ouvrir le menu :

| Commande | Effet |
|---|---|
| `/persona list` | liste les personas en texte, `*` marque l'active |
| `/persona ginette` | active Ginette tout de suite et pour les sessions suivantes |
| `/persona ginette --project` | active Ginette pour le projet courant seulement |
| `/persona random` (ou `/persona open-space`) | tire une persona au sort maintenant, puis à chaque nouvelle session, `/clear` et compaction (jamais deux fois la même d'affilée s'il y a le choix) |
| `/persona off` | désactive la persona globale |
| `/persona off --project` | aucune persona dans ce projet, même si une globale est active |
| `/persona reset --project` | retire le réglage du projet, la globale s'applique de nouveau |
| `/persona show [nom]` | affiche le texte exact envoyé à Claude |
| `/persona new <nom>` | crée `~/.claude/personas/<nom>.md` à partir du modèle |
| `/persona check [nom]` | vérifie une persona, ou toutes, et donne des conseils |

## Fonctionnement

- `scripts/persona.sh` est la source de vérité : fichiers d'état, tirage aléatoire, texte injecté. Le menu (`hooks/register.tsx`) ne fait que l'appeler.

- Un hook `SessionStart` (startup, resume, clear, compact) injecte la persona active en `additionalContext`. Elle survit donc à `/clear` et à la compaction.
- `/persona <nom>` l'applique aussi immédiatement dans la session en cours.
- Un cadre fixe entoure chaque persona : elle ne touche qu'au ton de la prose. Le code, les commits, la sécurité, les confirmations et CLAUDE.md priment toujours.

## Ajouter ses personas

Le plus simple : `/persona new <nom>` copie le modèle [`templates/persona.md`](templates/persona.md) dans votre bibliothèque. Remplacez chaque zone `<...>`, puis lancez `/persona check <nom>`.

Le modèle fixe les rubriques attendues (façon de parler, ressort comique, obsession, monde, exemples du ton, habitudes, croyances techniques, limites). `check` signale en erreur ce qui empêche la persona de fonctionner (frontmatter, `name` différent du nom de fichier, description absente, zones du modèle non remplies) et en conseil ce qui la rendrait répétitive (peu d'humeurs, peu d'exemples, rituels écrits comme des obligations).

Pour faire écrire une persona par Claude, donnez-lui le modèle et demandez-lui de passer `check` à la fin.

À la main, déposez un fichier `~/.claude/personas/<nom>.md` (nom en minuscules, chiffres, `-` ou `_`) :

```markdown
---
name: mon-perso
description: Une ligne affichée dans /persona list
---
Tu es ...
```

### Des personas vivantes

À chaque injection (nouvelle session, `/clear`, compaction, `/persona <nom>`), le plugin fait trois choses pour toute persona, sans rien demander à son fichier :

- il ajoute des règles de jeu communes : ne pas redire une formule, traiter les répliques entre guillemets comme des illustrations et non comme un répertoire, s'appuyer sur ce qui vient de se passer, doser selon la réponse ;
- il mélange l'ordre des répliques d'exemple (les lignes faites d'une seule réplique entre « guillemets »), sans en retirer aucune ;
- il tire une humeur du jour et donne la date.

Pour en tirer le meilleur :

- décrivez un ressort comique et un monde (des gens, des lieux, des objets) plutôt qu'une liste de phrases à placer ;
- présentez les rituels comme des penchants (« il t'arrive de »), pas comme des obligations (« chaque réponse finit par ») ;
- donnez à la persona ses propres humeurs, séparées par `|`, sur une ligne du frontmatter. Sans cette ligne, l'humeur vient d'une liste générique.

```markdown
---
name: mon-perso
description: Une ligne affichée dans /persona list
humeurs: tu as raté ton train | ton voisin a repeint sa clôture en violet
---
```

Une persona perso du même nom que celle du plugin la remplace. Les noms `random`, `open-space`, `off`, `none`, `list`, `ls`, `reset`, `show`, `inject`, `json`, `new` et `check` sont réservés aux commandes.

## Où est stocké le choix

- global : `~/.claude/personas/.active` (un nom, `random` ou `off`)
- projet : `<projet>/.claude/persona.local` (pensez à l'ajouter au `.gitignore` du projet)

## Mises à jour

Les mises à jour ne sont pas automatiques par défaut pour une marketplace ajoutée depuis GitHub.

- **Activer la mise à jour automatique** : `/plugin`, onglet **Marketplaces**, choisir `claude-personas`, puis activer la mise à jour automatique. Claude Code vérifie alors les nouvelles versions au début de chaque session.
- **Mettre à jour à la main** : `/plugin`, onglet **Installed**, choisir `personas`, puis **Update now**. Ou dans un terminal : `claude plugin update personas@claude-personas`.
- **Appliquer la mise à jour** : `/reload-plugins`, ou redémarrer Claude Code.

Une nouvelle version n'est proposée que lorsque le numéro `version` de `.claude-plugin/plugin.json` change.

## Coût en tokens

Le plugin augmente légèrement la consommation de tokens :

- **Sans persona active** : presque rien, une centaine de tokens au plus pour décrire la commande `/persona`.
- **Avec une persona active** : son texte est ajouté au contexte au début de la session, ainsi qu'après un `/clear` ou une compaction, qui repartent d'un contexte neuf. Comptez environ 1 500 à 3 000 tokens selon la persona.
- **Pendant la session** : ce texte reste dans le contexte, comme un CLAUDE.md. Grâce au cache des prompts de Claude, il coûte surtout à son premier envoi, puis très peu sur les messages suivants.
- **Changer de persona en cours de session** ajoute le texte de la nouvelle persona une fois de plus.

Une persona courte coûte moins cher : la taille du fichier `.md` est le principal levier.

## Licence

MIT

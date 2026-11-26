#!/usr/bin/env bash
# personas: load a persona into Claude Code's context without touching CLAUDE.md.
#
# Usage:
#   persona.sh inject                  SessionStart hook: prints the hook JSON
#   persona.sh json                    the state and the library, for the /persona menu
#   persona.sh [list]                  lists the personas and the active one
#   persona.sh <name> [--project]      activates a persona (global by default)
#   persona.sh random [--project]      a random persona at every session start, /clear and compaction
#                                      (alias: open-space)
#   persona.sh off [--project]         turns the persona off
#   persona.sh reset --project         drops the project override (falls back to global)
#   persona.sh show [name]             prints a persona as Claude would receive it
#   persona.sh new <name>              creates a persona in the user library from templates/persona.md
#   persona.sh check [name]            checks one persona, or all of them, against what the plugin expects
#
# Where things live:
#   library   : $PLUGIN_ROOT/personas/*.md, then ~/.claude/personas/*.md (yours win)
#   global    : ~/.claude/personas/.active      (a name, "random" or "off")
#   project   : <project>/.claude/persona.local (a name, "random" or "off", wins over global)
#   last draw : ~/.claude/personas/.last-random (avoids drawing the same persona twice in a row)
#
# Every injection also draws a mood for the session and shuffles the persona's
# quoted examples, so two sessions never start from the same text.
set -euo pipefail

# PERSONAS_SEED makes the draws (persona, mood, order of the examples) repeatable, for tests.
[[ -n "${PERSONAS_SEED:-}" ]] && RANDOM="$PERSONAS_SEED"

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
USER_DIR="${PERSONAS_USER_DIR:-$HOME/.claude/personas}"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
# Windows hands these over as C:\...; Git Bash reads C:/... the same, and a
# backslash never ends up read as an escape.
PLUGIN_ROOT="${PLUGIN_ROOT//\\//}"
USER_DIR="${USER_DIR//\\//}"
PROJECT_DIR="${PROJECT_DIR//\\//}"
GLOBAL_STATE="$USER_DIR/.active"
LAST_RANDOM="$USER_DIR/.last-random"
PROJECT_STATE="$PROJECT_DIR/.claude/persona.local"

valid_name() { [[ "$1" =~ ^[a-z0-9][a-z0-9_-]*$ ]]; }

# Path of a persona file, user library first.
find_persona() {
  local name="$1" f
  valid_name "$name" || return 1
  for f in "$USER_DIR/$name.md" "$PLUGIN_ROOT/personas/$name.md"; do
    [[ -f "$f" ]] && { echo "$f"; return 0; }
  done
  return 1
}

# Every persona name, deduplicated.
all_names() {
  local f
  for f in "$USER_DIR"/*.md "$PLUGIN_ROOT"/personas/*.md; do
    [[ -f "$f" ]] && basename "$f" .md
  done | sort -u
}

# Value of a frontmatter field.
field() {
  awk -v key="$2" '
    NR == 1 && $0 != "---" { exit }
    NR > 1 && $0 == "---" { exit }
    NR > 1 && index($0, key ":") == 1 { sub("^" key ":[ ]*", ""); print; exit }
  ' "$1"
}

# Persona text without its frontmatter.
body() {
  awk '
    NR == 1 && $0 == "---" { fm = 1; next }
    fm && $0 == "---" { fm = 0; next }
    !fm { print }
  ' "$1"
}

# Shuffles each run of consecutive lines that are a lone « quoted line », so
# no example keeps the first place from one session to the next. Nothing is dropped.
shuffle_quotes() {
  awk -v seed="$RANDOM" '
    function flush(  i, j, t) {
      for (i = n; i > 1; i--) { j = int(rand() * i) + 1; t = q[i]; q[i] = q[j]; q[j] = t }
      for (i = 1; i <= n; i++) print q[i]
      n = 0
    }
    BEGIN { srand(seed) }
    /^[[:space:]]*([-*][[:space:]]+)?«.*»[[:space:]]*$/ { q[++n] = $0; next }
    { flush(); print }
    END { flush() }
  '
}

# Moods any persona can play, used when it declares none of its own.
GENERIC_MOODS=(
  "tu as la tête ailleurs"
  "tu es d'excellente humeur, sans raison avouable"
  "tu as mal dormi"
  "tu te sens d'humeur nostalgique"
  "un détail de ce matin t'a mis de travers"
  "tu gardes pour toi une bonne nouvelle"
  "tu es d'un calme inhabituel"
  "tu as faim"
  "tu te méfies de tout un peu plus que d'habitude"
  "tu es d'humeur bavarde"
  "tu es d'humeur taiseuse : peu de mots, mais choisis"
  "tu as hâte d'en finir, quelque chose t'attend"
)

# One mood for the session: from the persona's "humeurs:" field (separated by
# "|") when it has one, from the generic list otherwise.
pick_mood() {
  local raw moods=() m
  raw="$(field "$1" humeurs)"
  [[ -n "$raw" ]] && IFS='|' read -ra moods <<<"$raw"
  (( ${#moods[@]} == 0 )) && moods=("${GENERIC_MOODS[@]}")
  m="${moods[RANDOM % ${#moods[@]}]}"
  m="${m#"${m%%[![:space:]]*}"}"
  m="${m%"${m##*[![:space:]]}"}"
  [[ -z "$m" ]] && m="${GENERIC_MOODS[RANDOM % ${#GENERIC_MOODS[@]}]}"
  echo "$m"
}

# Today's date in French, whatever the locale.
today() {
  local days=(lundi mardi mercredi jeudi vendredi samedi dimanche)
  local months=(janvier février mars avril mai juin juillet août septembre octobre novembre décembre)
  echo "${days[$(date +%u) - 1]} $(date +%-d) ${months[$(date +%-m) - 1]} $(date +%Y)"
}

# Draws a persona, different from the previous draw when there is a choice.
pick_random() {
  local last names=() n
  last="$(read_state "$LAST_RANDOM")"
  while read -r n; do [[ -n "$n" ]] && names+=("$n"); done < <(all_names)
  (( ${#names[@]} == 0 )) && return 1
  if (( ${#names[@]} > 1 )); then
    local others=()
    for n in "${names[@]}"; do [[ "$n" != "$last" ]] && others+=("$n"); done
    names=("${others[@]}")
  fi
  n="${names[RANDOM % ${#names[@]}]}"
  mkdir -p "$USER_DIR" && echo "$n" > "$LAST_RANDOM"
  echo "$n"
}

# Turns a state value into the persona to load now ("random" draws one).
effective() {
  if [[ "$1" == "random" ]]; then pick_random; else echo "$1"; fi
}

read_state() { [[ -f "$1" ]] && tr -d '[:space:]' < "$1" || true; }

# Active persona name ("" or "off" when none) and where it comes from.
resolve() {
  local p g
  p="$(read_state "$PROJECT_STATE")"
  if [[ -n "$p" ]]; then echo "$p project"; return; fi
  g="$(read_state "$GLOBAL_STATE")"
  if [[ -n "$g" ]]; then echo "$g global"; return; fi
  echo "off none"
}

# The text Claude receives: a fixed frame around the persona.
render() {
  local name="$1" file
  file="$(find_persona "$name")" || return 1
  cat <<EOF
# Persona active : $name

Pour cette session, adopte la persona ci-dessous. Elle a été choisie par l'utilisateur via le plugin personas et complète ses instructions, sans en retirer aucune.

Cadre, prioritaire sur la persona :
- La persona ne change que le ton de tes réponses en prose.
- Le code, les commandes, les commits, les commentaires et les fichiers que tu écris restent sobres et conformes aux normes du projet.
- Les instructions du CLAUDE.md, la mémoire, les consignes de sécurité et les demandes de confirmation priment toujours sur la persona. Pour un avertissement de sécurité ou une action irréversible, sors du personnage le temps de le dire clairement.
- La persona n'invente jamais de faits : elle décore, elle ne remplace pas les preuves.

Jeu, pour que le personnage reste vivant :
- Les répliques entre guillemets dans la persona illustrent un ton, ce n'est pas un répertoire : n'en reprends aucune mot pour mot, invente les tiennes dans le même esprit.
- Ne redis jamais une formule, une ouverture ou une chute déjà utilisée dans cette session. Un gag récurrent évolue (il avance, se complique, se retourne), il ne se répète pas.
- Les rituels et les fréquences décrits par la persona sont des tendances, pas des obligations : varie leur place et leur forme, et saute-les quand ils alourdiraient.
- Appuie-toi sur ce qui vient réellement de se passer (le fichier, l'erreur, la commande, la taille du changement) plutôt que sur une formule toute faite.
- Dose, sans disparaître : le personnage s'entend dans chaque réponse en prose, par sa voix, son vocabulaire et son regard sur ce qui se passe. Une réponse courte ou urgente reçoit une touche nette, pas le numéro complet, mais jamais zéro.
- Ça vaut aussi pour les messages intermédiaires entre deux appels d'outils, même très courts : chaque phrase que l'utilisateur lit pendant une recherche ou un long travail est dite par le personnage, pas seulement la réponse finale. Seules les descriptions des appels d'outils restent neutres.
- Ne récite jamais ta fiche : le passé et le monde du personnage sont ce qu'il sait, pas ce qu'il raconte. Une question sur lui se traite comme le reste, par un détail choisi, jamais par un inventaire.
- Ne sors pas du rôle pour rappeler que c'est un rôle : l'utilisateur a choisi cette persona. Dis-le seulement s'il demande sérieusement à qui il parle, ou quand le cadre ci-dessus l'exige.

Aujourd'hui, $(today) : $(pick_mood "$file"). Laisse cette disposition colorer la session à la manière du personnage, sans l'annoncer telle quelle.

---

$(body "$file" | shuffle_quotes)
EOF
}

# A SessionStart hook's plain stdout is added to the context as is: no JSON,
# so no jq.
cmd_inject() {
  local name text
  read -r name _ <<<"$(resolve)"
  [[ "$name" == "off" ]] && exit 0
  name="$(effective "$name")" || exit 0
  text="$(render "$name")" || exit 0   # unknown persona: stay silent, never block a session
  printf '%s\n' "$text"
}

# A JSON string literal, quotes included. Character by character rather than
# gsub, whose backslash rules differ between gawk, mawk and macOS awk.
json_str() {
  printf '%s' "$1" | awk '
    BEGIN { ORS = ""; print "\"" }
    {
      if (NR > 1) print "\\n"
      out = ""
      for (i = 1; i <= length($0); i++) {
        c = substr($0, i, 1)
        if (c == "\\") out = out "\\\\"
        else if (c == "\"") out = out "\\\""
        else if (c == "\t") out = out "\\t"
        else if (c == "\r") out = out "\\r"
        else out = out c
      }
      print out
    }
    END { print "\"" }
  '
}

cmd_list() {
  local name src active n f desc mark
  read -r active src <<<"$(resolve)"
  echo "Personas disponibles :"
  while read -r n; do
    [[ -z "$n" ]] && continue
    f="$(find_persona "$n")" || continue
    desc="$(field "$f" description)"
    mark="  "; [[ "$n" == "$active" ]] && mark="* "
    echo "${mark}${n}${desc:+ : $desc}"
  done < <(all_names)
  echo
  if [[ "$active" == "off" ]]; then
    echo "Active : aucune"
  else
    echo "Active : $active ($src)"
  fi
  [[ "$active" == "random" ]] && echo "Mode random : une persona tirée au sort à chaque session, /clear et compaction (dernière : $(read_state "$LAST_RANDOM"))."
  :
  echo "Bibliothèque perso : $USER_DIR"
}

write_state() {
  mkdir -p "$(dirname "$1")"
  echo "$2" > "$1"
}

cmd_set() {
  local name="$1" scope="$2" target
  if ! find_persona "$name" >/dev/null; then
    echo "Persona inconnue : $name"
    echo
    cmd_list
    exit 0
  fi
  target="$GLOBAL_STATE"; [[ "$scope" == "project" ]] && target="$PROJECT_STATE"
  write_state "$target" "$name"
  echo "PERSONA_ACTIVATED $name ($scope)"
  if [[ "$scope" == "global" && -n "$(read_state "$PROJECT_STATE")" ]]; then
    echo "Attention : ce projet a sa propre persona ($(read_state "$PROJECT_STATE")), elle reste prioritaire ici. /persona reset --project pour la retirer."
  fi
  echo
  render "$name"
}

cmd_random() {
  local scope="$1" target name
  target="$GLOBAL_STATE"; [[ "$scope" == "project" ]] && target="$PROJECT_STATE"
  name="$(pick_random)" || { echo "Aucune persona dans la bibliothèque."; exit 0; }
  write_state "$target" random
  echo "PERSONA_ACTIVATED $name (random, $scope)"
  echo "Mode random : une nouvelle persona sera tirée au sort à chaque session, /clear et compaction."
  echo
  render "$name"
}

cmd_off() {
  local scope="$1"
  if [[ "$scope" == "project" ]]; then
    write_state "$PROJECT_STATE" off
  else
    rm -f "$GLOBAL_STATE"
  fi
  echo "PERSONA_DEACTIVATED ($scope)"
  local name src
  read -r name src <<<"$(resolve)"
  if [[ "$name" != "off" ]]; then
    echo "Attention : la persona $name reste active via la config $src."
  fi
}

cmd_reset() {
  rm -f "$PROJECT_STATE"
  local name src
  read -r name src <<<"$(resolve)"
  echo "PERSONA_PROJECT_RESET"
  if [[ "$name" == "off" ]]; then
    echo "PERSONA_DEACTIVATED (aucune persona globale)"
  else
    [[ "$name" == "random" ]] && name="$(pick_random)"
    echo "PERSONA_ACTIVATED $name ($src)"
    echo
    render "$name"
  fi
}

# Shows a persona without drawing: in random mode, the persona of the last draw.
cmd_show() {
  local name="$1"
  if [[ -z "$name" ]]; then
    read -r name _ <<<"$(resolve)"
    [[ "$name" == "random" ]] && name="$(read_state "$LAST_RANDOM")"
  fi
  render "$name" 2>/dev/null || echo "Aucune persona active ou persona inconnue."
}

RESERVED=(random open-space off none list ls reset show inject json new check)

is_reserved() {
  local r
  for r in "${RESERVED[@]}"; do [[ "$r" == "$1" ]] && return 0; done
  return 1
}

# Creates a persona in the user library from the template.
cmd_new() {
  local name="$1" target="$USER_DIR/$1.md" template="$PLUGIN_ROOT/templates/persona.md"
  if [[ -z "$name" ]]; then echo "Usage : /persona new <nom>"; return 0; fi
  if ! valid_name "$name"; then
    echo "Nom invalide : $name (minuscules, chiffres, - ou _, sans commencer par - ou _)."
    return 0
  fi
  if is_reserved "$name"; then echo "Nom réservé aux commandes : $name"; return 0; fi
  if [[ -f "$target" ]]; then echo "Cette persona existe déjà : $target"; return 0; fi
  mkdir -p "$USER_DIR"
  sed "s/__NAME__/$name/" "$template" > "$target"
  echo "Persona créée à partir du modèle : $target"
  if [[ -f "$PLUGIN_ROOT/personas/$name.md" ]]; then
    echo "Attention : elle remplace la persona du plugin qui porte le même nom."
  fi
  echo "Remplacez chaque zone <...>, puis lancez /persona check $name."
}

# Checks one persona against what the plugin expects. Returns 1 on an error.
check_one() {
  local name="$1" file n raw b quotes errors=() warns=() parts=() m
  if ! file="$(find_persona "$name")"; then
    echo "ERREUR $name : persona introuvable"
    return 1
  fi
  if [[ "$(head -n 1 "$file")" != "---" ]]; then
    errors+=("pas de frontmatter : le fichier doit commencer par ---")
  fi
  n="$(field "$file" name)"
  if [[ "$n" != "$name" ]]; then
    errors+=("le champ name (\"$n\") doit valoir le nom du fichier (\"$name\")")
  fi
  if [[ -z "$(field "$file" description)" ]]; then errors+=("champ description manquant"); fi
  if is_reserved "$name"; then errors+=("nom réservé aux commandes"); fi
  b="$(body "$file")"
  if [[ -z "${b//[[:space:]]/}" ]]; then errors+=("texte de la persona vide"); fi
  if grep -qE '__NAME__|<[^<>]*[[:space:]][^<>]*>' "$file"; then
    errors+=("il reste des zones du modèle à remplir (<...>)")
  fi

  raw="$(field "$file" humeurs)"
  if [[ -z "$raw" ]]; then
    warns+=("pas de champ humeurs : l'humeur du jour viendra de la liste générique")
  else
    IFS='|' read -ra parts <<<"$raw"
    if (( ${#parts[@]} < 4 )); then
      warns+=("${#parts[@]} humeur(s) seulement : à partir de 5, les sessions se ressemblent moins")
    fi
  fi
  quotes="$(grep -cE '^[[:space:]]*([-*][[:space:]]+)?«.*»[[:space:]]*$' <<<"$b" || true)"
  if (( quotes < 4 )); then
    warns+=("$quotes réplique(s) d'exemple seule(s) sur leur ligne entre « » : avec moins de 4, le modèle s'y accroche")
  fi
  if grep -qiE 'chaque réponse|toujours par|systématiquement|une réponse sur' <<<"$b"; then
    warns+=("un rituel est écrit comme une obligation (« chaque réponse », « une réponse sur trois »...) : préférez « il t'arrive de »")
  fi
  if ! grep -qi 'code' <<<"$b"; then
    warns+=("rien ne dit que le code reste sobre : reprenez la phrase du modèle")
  fi
  if (( ${#b} > 4500 )); then
    warns+=("texte long (${#b} caractères) : il est injecté en entier à chaque session")
  fi

  if (( ${#errors[@]} > 0 )); then
    echo "ERREUR $name ($file)"
    for m in "${errors[@]}"; do echo "  erreur : $m"; done
  else
    echo "OK $name ($file)"
  fi
  if (( ${#warns[@]} > 0 )); then
    for m in "${warns[@]}"; do echo "  conseil : $m"; done
  fi
  (( ${#errors[@]} == 0 ))
}

# Checks one persona, or the whole library.
cmd_check() {
  local n failed=0
  if [[ -n "$1" ]]; then
    check_one "$1" || failed=1
  else
    while read -r n; do
      [[ -z "$n" ]] && continue
      check_one "$n" || failed=1
    done < <(all_names)
  fi
  echo
  if (( failed )); then
    echo "PERSONA_CHECK_FAILED"
  else
    echo "PERSONA_CHECK_OK"
  fi
}

# Everything the menu draws, as one JSON object.
cmd_json() {
  local active src n f origin sep=""
  read -r active src <<<"$(resolve)"
  printf '{"active":%s,"source":%s,"global":%s,"project":%s,"lastRandom":%s,"userDir":%s,"personas":[' \
    "$(json_str "$active")" "$(json_str "$src")" \
    "$(json_str "$(read_state "$GLOBAL_STATE")")" "$(json_str "$(read_state "$PROJECT_STATE")")" \
    "$(json_str "$(read_state "$LAST_RANDOM")")" "$(json_str "$USER_DIR")"
  while read -r n; do
    [[ -z "$n" ]] && continue
    f="$(find_persona "$n")" || continue
    origin=plugin; [[ "$f" == "$USER_DIR/"* ]] && origin=user
    printf '%s{"name":%s,"description":%s,"origin":%s,"preview":%s}' "$sep" \
      "$(json_str "$n")" "$(json_str "$(field "$f" description)")" "$(json_str "$origin")" \
      "$(json_str "$(body "$f" | grep -v '^[[:space:]]*$' | head -12 | cut -c1-600)")"
    sep=","
  done < <(all_names)
  printf ']}\n'
}

main() {
  local scope="global" args=() a
  for a in "$@"; do
    case "$a" in
      --project) scope="project" ;;
      --global) scope="global" ;;
      *) args+=("$a") ;;
    esac
  done
  local sub="${args[0]:-list}"
  case "$sub" in
    inject) cmd_inject ;;
    json) cmd_json ;;
    list|ls|"") cmd_list ;;
    off|none) cmd_off "$scope" ;;
    random|open-space) cmd_random "$scope" ;;
    reset) cmd_reset ;;
    show) cmd_show "${args[1]:-}" ;;
    new) cmd_new "${args[1]:-}" ;;
    check) cmd_check "${args[1]:-}" ;;
    *) cmd_set "$sub" "$scope" ;;
  esac
}

main "$@"

# Claude Code status line: git context + model + context-window usage.
# Wired up via the "statusLine" key in ~/.claude/settings.json.

# Stdin and stdout go through raw streams because the [Console] encoding setters
# can fail with no console attached. Git's output still needs the setter.
try { [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false) } catch { }
[cultureinfo]::CurrentCulture = [cultureinfo]::InvariantCulture

$reader = [IO.StreamReader]::new([Console]::OpenStandardInput(), [Text.UTF8Encoding]::new($false))
try { $p = $reader.ReadToEnd() | ConvertFrom-Json } catch { $p = $null }

$e = [char]27
$now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()

function Paint($sgr, $text) { "$e[${sgr}m$text$e[0m" }

# [math]::Round goes to the nearest even number at .5, as printf's %.0f does.
# Truncating x + 0.5 is the other way this script rounds.
function Whole($n) { [math]::Round([double]$n).ToString('F0') }
function Cents($n) { [math]::Round([double]$n, 2).ToString('F2') }
function RoundUp($n) { [long][math]::Truncate([double]$n + 0.5) }

# When a quota window resets, as epoch seconds; $null when the payload names none.
# Epoch seconds is what it carries, sometimes as milliseconds; an ISO string is
# read too, which ConvertFrom-Json may already have turned into a date.
function Get-ResetTime($v) {
  if ($null -eq $v) { return $null }
  if ($v -is [datetime]) { return ([DateTimeOffset]$v).ToUnixTimeSeconds() }
  if ($v -is [string]) {
    $d = [DateTimeOffset]::MinValue
    if ([DateTimeOffset]::TryParse($v, $null, [Globalization.DateTimeStyles]::AssumeUniversal, [ref]$d)) {
      return $d.ToUnixTimeSeconds()
    }
    return $null
  }
  $n = [double]$v
  if ($n -gt 100000000000) { $n /= 1000 }
  [long][math]::Floor($n)
}

$model = $p.model.display_name ?? 'unknown'
$effort = $p.effort.level
$ctxSize = [double]($p.context_window.context_window_size ?? 0)
$inTok = [double]($p.context_window.total_input_tokens ?? 0)
$usedPct = $p.context_window.used_percentage
$cwd = $p.workspace.current_dir ?? $p.cwd
$costUsd = [double]($p.cost.total_cost_usd ?? 0)
$sid = $p.session_id ?? 'unknown'
$q5 = $p.rate_limits.five_hour.used_percentage
$q7 = $p.rate_limits.seven_day.used_percentage
$r5 = Get-ResetTime $p.rate_limits.five_hour.resets_at
$r7 = Get-ResetTime $p.rate_limits.seven_day.resets_at

# Shared green -> amber -> orange -> red ramp for any 0-100 gauge.
# 100+ goes gold, matching the credit-spend marker below.
function Get-PctSgr($pct) {
  if ($pct -ge 100) { '1;38;5;214' }
  elseif ($pct -ge 90) { '1;38;5;196' }
  elseif ($pct -ge 75) { '38;5;208' }
  elseif ($pct -ge 50) { '38;5;220' }
  else { '38;5;41' }
}

# A quota window is coloured by pace, not level: where it lands at its reset if
# the rest of it goes at the average rate so far. Green while that leaves quota
# over, then amber, orange and red as the projection passes 100, 125 and 150.
# Under 25% used the projection is noise, 90%+ used keeps its raw level whatever
# the pace, and so does a window whose reset is unknown, past, or further off
# than the window is long.
function Get-QuotaSgr($used, $resetsAt, $windowSeconds) {
  $left = if ($null -eq $resetsAt) { 0 } else { $resetsAt - $now }
  if ($used -ge 90 -or $left -le 0 -or $left -ge $windowSeconds) { return Get-PctSgr $used }
  $pace = $used / (1 - $left / $windowSeconds)
  if ($used -lt 25 -or $pace -le 100) { Get-PctSgr 0 }
  elseif ($pace -le 125) { Get-PctSgr 50 }
  elseif ($pace -le 150) { Get-PctSgr 75 }
  else { Get-PctSgr 90 }
}

# Time to a window's reset as " (45m)", " (2h)" or " (4d)"; empty when unknown
# or past.
function Get-TimeLeft($resetsAt) {
  if ($null -eq $resetsAt -or $resetsAt -le $now) { return '' }
  $m = RoundUp (($resetsAt - $now) / 60)
  if ($m -lt 60) { return " (${m}m)" }
  $h = RoundUp ($m / 60)
  if ($h -lt 24) { " (${h}h)" } else { " ($(RoundUp ($h / 24))d)" }
}

if ($cwd) { Set-Location -LiteralPath $cwd -ErrorAction SilentlyContinue }

# ---------- git segment: repo, branch, working-tree state ----------
$gitSeg = ''
$root = git rev-parse --show-toplevel 2>$null
if ($LASTEXITCODE -eq 0 -and $root) {
  $repo = ($root.TrimEnd('/') -split '/')[-1]
  $branch = ''
  $ahead = $behind = $staged = $unstaged = $untracked = $conflict = 0

  foreach ($line in (git status --porcelain=v2 --branch 2>$null)) {
    if ($line.StartsWith('# branch.head ')) {
      $branch = $line.Substring(14)
    } elseif ($line.StartsWith('# branch.ab ')) {
      $ab = $line.Substring(12) -split ' '
      $ahead = [int]$ab[0].TrimStart('+')
      $behind = [int]$ab[1].TrimStart('-')
    } elseif ($line.StartsWith('1 ') -or $line.StartsWith('2 ')) {
      $xy = ($line -split ' ', 3)[1]
      if ($xy[0] -ne '.') { $staged++ }
      if ($xy[1] -ne '.') { $unstaged++ }
    } elseif ($line.StartsWith('u ')) {
      $conflict++
    } elseif ($line.StartsWith('? ')) {
      $untracked++
    }
  }

  # Detached HEAD reports "(detached)" — show the short sha instead.
  if ($branch -eq '(detached)') { $branch = git rev-parse --short HEAD 2>$null }

  $flags = ''
  if ($staged -gt 0) { $flags += " +$staged" }
  if ($unstaged -gt 0) { $flags += " ●$unstaged" }
  if ($untracked -gt 0) { $flags += " ?$untracked" }
  if ($conflict -gt 0) { $flags += " ✖$conflict" }
  if ($ahead -gt 0) { $flags += " ↑$ahead" }
  if ($behind -gt 0) { $flags += " ↓$behind" }

  $gitSeg = (Paint 36 $repo) + ' ' + (Paint 35 ($branch ? $branch : '?')) + (Paint 33 $flags) + '  ' + (Paint 2 '|') + '  '
}

# ---------- model colour: cost tier ----------
# Per-MTok list price (input/output) drives the intensity ramp — pricier = louder.
#   Fable 5 / Mythos 5   $10 / $50   bold magenta
#   Opus 5, Opus 4.x     $5  / $25   orange
#   Sonnet 5, Sonnet 4.6 $3  / $15   teal
#   Haiku 4.5            $1  / $5    grey
$modelSgr = switch -Wildcard ($model.ToLowerInvariant()) {
  '*fable*' { '1;38;5;199'; break }
  '*mythos*' { '1;38;5;199'; break }
  '*opus*' { '38;5;208'; break }
  '*sonnet*' { '38;5;37'; break }
  '*haiku*' { '38;5;245'; break }
  default { '2' }  # unknown model — stay quiet
}

# ---------- effort colour: independent brightness ramp ----------
# Deliberately hueless so it reads as "how hard it's working" without
# competing with the cost hue or the context traffic-light.
$effortSgr = switch ($effort) {
  'low' { '38;5;240' }
  'medium' { '38;5;245' }
  'high' { '38;5;252' }
  'xhigh' { '38;5;231' }
  'max' { '1;38;5;231' }
  default { '2' }
}

# ---------- context-window bar ----------
if ($null -eq $usedPct) { $usedPct = $ctxSize -gt 0 ? $inTok * 100 / $ctxSize : 0 }

$pctInt = Whole $usedPct
$filled = [math]::Clamp((RoundUp ($usedPct / 100 * 20)), 0, 20)
$barOn = '█' * $filled
$barOff = '░' * (20 - $filled)
$usedK = "$(Whole ($inTok / 1000))k"
$totalK = $ctxSize -ge 1000000 ? "$(($ctxSize / 1000000).ToString('G6'))M" : "$(Whole ($ctxSize / 1000))k"

$ctxSgr = Get-PctSgr ([double]$pctInt)

# ---------- quota meters + notional/credit cost ----------
# The payload has NO explicit "using credits" flag — the only available signal
# is a rate-limit window at 100%, so credit mode is inferred from that.
$inOverage = ($q5 ?? 0) -ge 100 -or ($q7 ?? 0) -ge 100

# cost.total_cost_usd is cumulative and does not split plan-covered from
# credit spend. Snapshot the total the first refresh we see overage, then
# report the delta as the amount actually charged to credits.
$stateFile = Join-Path $HOME ".claude/.statusline-state/$sid.overage"
$creditUsd = ''
if ($inOverage) {
  $base = 0.0
  try {
    if (Test-Path -LiteralPath $stateFile) {
      $base = [double][IO.File]::ReadAllText($stateFile)
    } else {
      [void][IO.Directory]::CreateDirectory((Split-Path $stateFile))
      [IO.File]::WriteAllText($stateFile, [string]$costUsd)
      $base = $costUsd
    }
  } catch { }
  $creditUsd = Cents ([math]::Max($costUsd - $base, 0))
} elseif (Test-Path -LiteralPath $stateFile) {
  # Back under quota — re-snapshot next time.
  Remove-Item -LiteralPath $stateFile -ErrorAction SilentlyContinue
}

$quotaSeg = ''
if ($null -ne $q5 -or $null -ne $q7) {
  $u5 = [double]($q5 ?? 0)
  $u7 = [double]($q7 ?? 0)
  $quotaSeg = '  ' + (Paint (Get-QuotaSgr $u5 $r5 18000) "5h $(Whole $u5)%$(Get-TimeLeft $r5)") +
    ' ' + (Paint 2 '·') + ' ' + (Paint (Get-QuotaSgr $u7 $r7 604800) "7d $(Whole $u7)%$(Get-TimeLeft $r7)")
}

# ---------- prompt cache countdown ----------
# Absent until the first response. Coloured by how much of the TTL has gone, so
# 5m and 1h read alike. The payload's expiry is an estimate of the server's, and
# it counts main-conversation requests only.
# Idle updates depend on statusLine.refreshInterval in settings.json.
$cacheSeg = ''
$cacheTtl = $p.prompt_cache.ttl
if ($cacheTtl) {
  $cacheExp = $p.prompt_cache.expires_at
  $ttlSeconds = $cacheTtl -eq '5m' ? 300 : 3600
  if ($p.prompt_cache.warm -eq $true -and $null -ne $cacheExp -and $cacheExp -gt $now) {
    $gone = [double](Whole (100 - ($cacheExp - $now) * 100 / $ttlSeconds))
    $cacheSeg = '  ' + (Paint (Get-PctSgr $gone) "cache$(Get-TimeLeft $cacheExp)")
  } else {
    $cacheSeg = '  ' + (Paint 2 'cache cold')
  }
}

# Notional (plan-covered) always shown with ~; real credit spend gets the bag.
$costSeg = '  ' + (Paint 2 "~`$$(Cents $costUsd)")
if ($inOverage) { $costSeg += ' ' + (Paint '1;38;5;214' "💰`$$creditUsd") }

$modelPart = Paint $modelSgr $model
if ($effort) { $modelPart += ' ' + (Paint $effortSgr "[$effort]") }

$line = $gitSeg + $modelPart + '  ' + (Paint 2 '[') + (Paint $ctxSgr $barOn) + (Paint 2 "$barOff]") + ' ' +
  (Paint $ctxSgr "$pctInt%") + '  ' + (Paint $ctxSgr $usedK) + ' ' + (Paint 2 "/ $totalK") +
  $quotaSeg + $cacheSeg + $costSeg

$bytes = [Text.UTF8Encoding]::new($false).GetBytes($line)
$stdout = [Console]::OpenStandardOutput()
$stdout.Write($bytes, 0, $bytes.Length)
$stdout.Flush()

import { spawnSync } from "node:child_process";

export function normalizeContinueAsNames(profile = {}, explicitName = "") {
  const names = [];
  const add = (value) => {
    const normalized = String(value ?? "").trim();
    if (!normalized) return;
    if (/^profile\s*\d+$/i.test(normalized)) return;
    if (/^default$/i.test(normalized)) return;
    if (/^lambenti\.com$/i.test(normalized)) return;
    if (normalized.includes("@")) return;
    if (!names.some((existing) => existing.toLowerCase() === normalized.toLowerCase())) {
      names.push(normalized);
    }
  };

  add(explicitName);
  add(profile.profileGaiaName);
  add(profile.profileName);
  add(profile.profileEmail?.split("@")[0]);

  for (const name of [...names]) {
    const first = name.split(/\s+/)[0];
    if (first && first !== name) add(first);
  }

  return names;
}

export function buildSavedGoogleContinueRegexSource(names = []) {
  const normalizedNames = (Array.isArray(names) ? names : [names])
    .map((name) => String(name ?? "").trim())
    .filter(Boolean)
    .filter((name, index, all) => all.findIndex((candidate) => candidate.toLowerCase() === name.toLowerCase()) === index);
  if (normalizedNames.length === 0) return "^\\s*Continue\\s+as\\s+.+";
  const alternatives = normalizedNames
    .sort((a, b) => b.length - a.length)
    .map(escapeRegex)
    .join("|");
  return `^\\s*Continue\\s+as\\s+(?:${alternatives})(?:\\b|\\s|$)`;
}

export function matchesSavedGoogleContinueButtonName(name, regexSource) {
  return new RegExp(regexSource, "i").test(String(name ?? ""));
}

export function normalizeTrustedAlibabaAccountEmails(profile = {}, explicitEmails = "") {
  const emails = [];
  const add = (value) => {
    for (const part of String(value ?? "").split(",")) {
      const normalized = part.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) continue;
      if (!emails.includes(normalized)) emails.push(normalized);
    }
  };
  add(explicitEmails);
  add(profile.profileEmail);
  return emails;
}

export function buildAlibabaAccountConfirmRegexSource(emails = []) {
  const normalizedEmails = normalizeTrustedAlibabaAccountEmails({}, emails.join?.(",") ?? emails);
  if (normalizedEmails.length === 0) return "(?!)";
  const alternatives = normalizedEmails
    .sort((a, b) => b.length - a.length)
    .map(escapeRegex)
    .join("|");
  return `Continue\\s+as\\s+(?:${alternatives})\\??`;
}

export function matchesAlibabaAccountConfirmationText(text, regexSource) {
  return new RegExp(regexSource, "i").test(String(text ?? ""));
}

export function buildWindowsUiClickButtonScript({ regexSource, timeoutMs = 8000 } = {}) {
  const safeTimeoutMs = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0 ? Math.floor(Number(timeoutMs)) : 8000;
  const encodedRegex = powerShellSingleQuotedString(String(regexSource ?? "^\\s*Continue\\s+as\\s+.+"));
  return `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$regex = ${encodedRegex}
$deadline = [DateTime]::UtcNow.AddMilliseconds(${safeTimeoutMs})
$buttonCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
while ([DateTime]::UtcNow -lt $deadline) {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $buttons = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition)
  foreach ($button in $buttons) {
    $name = $button.Current.Name
    if ($name -and ($name -match $regex)) {
      $pattern = $null
      if ($button.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
        $pattern.Invoke()
        Write-Output ("clicked:" + $name)
        exit 0
      }
      $rect = $button.Current.BoundingRectangle
      if (-not $rect.IsEmpty) {
        [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point([int]($rect.Left + ($rect.Width / 2)), [int]($rect.Top + ($rect.Height / 2)))
        Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int cButtons, int dwExtraInfo);' -Name NativeMouse -Namespace Win32
        [Win32.NativeMouse]::mouse_event(0x0002, 0, 0, 0, 0)
        [Win32.NativeMouse]::mouse_event(0x0004, 0, 0, 0, 0)
        Write-Output ("clicked:" + $name)
        exit 0
      }
    }
  }
  Start-Sleep -Milliseconds 250
}
Write-Output 'not-found'
exit 2
`.trim();
}

export function buildWindowsUiClickAlibabaAccountConfirmScript({ accountRegexSource, timeoutMs = 8000 } = {}) {
  const safeTimeoutMs = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0 ? Math.floor(Number(timeoutMs)) : 8000;
  const encodedAccountRegex = powerShellSingleQuotedString(String(accountRegexSource ?? "(?!)"));
  return `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$accountRegex = ${encodedAccountRegex}
$yesRegex = '^\\s*Yes\\s*$'
$deadline = [DateTime]::UtcNow.AddMilliseconds(${safeTimeoutMs})
$buttonCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
$trueCondition = [System.Windows.Automation.Condition]::TrueCondition
while ([DateTime]::UtcNow -lt $deadline) {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $trueCondition)
  $text = New-Object System.Text.StringBuilder
  foreach ($element in $all) {
    $name = $element.Current.Name
    if ($name) { [void]$text.AppendLine($name) }
  }
  if (($text.ToString()) -match $accountRegex) {
    $buttons = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition)
    foreach ($button in $buttons) {
      $name = $button.Current.Name
      if ($name -and ($name -match $yesRegex)) {
        $pattern = $null
        if ($button.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
          $pattern.Invoke()
          Write-Output ("clicked:" + $name)
          exit 0
        }
        $rect = $button.Current.BoundingRectangle
        if (-not $rect.IsEmpty) {
          [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point([int]($rect.Left + ($rect.Width / 2)), [int]($rect.Top + ($rect.Height / 2)))
          Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int cButtons, int dwExtraInfo);' -Name NativeMouse -Namespace Win32
          [Win32.NativeMouse]::mouse_event(0x0002, 0, 0, 0, 0)
          [Win32.NativeMouse]::mouse_event(0x0004, 0, 0, 0, 0)
          Write-Output ("clicked:" + $name)
          exit 0
        }
      }
    }
  }
  Start-Sleep -Milliseconds 250
}
Write-Output 'not-found'
exit 2
`.trim();
}

export function clickWindowsUiButtonByRegex({ regexSource, timeoutMs = 8000 } = {}) {
  if (process.platform !== "win32") return { clicked: false, skipped: true, reason: "windows-ui-only" };
  const script = buildWindowsUiClickButtonScript({ regexSource, timeoutMs });
  return runWindowsUiAutomationScript(script, timeoutMs);
}

export function clickWindowsAlibabaAccountConfirm({ accountRegexSource, timeoutMs = 8000 } = {}) {
  if (process.platform !== "win32") return { clicked: false, skipped: true, reason: "windows-ui-only" };
  const script = buildWindowsUiClickAlibabaAccountConfirmScript({ accountRegexSource, timeoutMs });
  return runWindowsUiAutomationScript(script, timeoutMs);
}

function runWindowsUiAutomationScript(script, timeoutMs) {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], {
    encoding: "utf8",
    timeout: Math.max(Number(timeoutMs) + 5000, 10_000),
    windowsHide: true
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return {
    clicked: result.status === 0 && /^clicked:/im.test(output),
    skipped: false,
    status: result.status,
    output
  };
}

function powerShellSingleQuotedString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

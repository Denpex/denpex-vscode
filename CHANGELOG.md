# Changelog

## 1.4.59

- Align the investigation console and sidebar styling with the Denpex dashboard theme (`#151515` canvas, `#1C1C1C` cards, and terracotta `#D6795C` accents).
- Add the False-Blame Shield banner when local diagnosis exonerates physical GPU silicon and RDMA fabrics on TorchDynamo recompile stalls, MoE hot-expert routing skew, FP8 amax overflow, or parallel filesystem checkpoint stalls.
- Promote local GPU artifact inspection (`denpex_artifacts.py`) to a top-level action card and synchronize the bundled offline engine (`2026.11.09+frontier-22-r1`).
- Preserve the existing extension identity and published grid icon.

## 1.4.58

- Update repository, issue tracker and screenshot links to the official Denpex GitHub organization (`https://github.com/Denpex/denpex-vscode`).
- Expand documentation and GPU reference links in the Support section.
- Preserve the existing diagnosis behavior and extension artwork.

## 1.4.57

- Clarify how to investigate saved training and inference logs alongside Flight Recorder dumps, memory snapshots and host evidence.
- Add a known-incident evaluation checklist and explain the limits of local diagnosis and synthetic samples.
- Preserve the existing diagnosis behavior and extension artwork.

## 1.4.56

- Keep device attribution unresolved in offline headlines when identity or timing evidence is incomplete or inconsistent.
- Use the current shared engine. Cloud monitoring retains investigations during review-capacity and queue outages.

## 1.4.55

- Use the current shared diagnosis engine and retain evidence requests across follow-ups.
- Distinguish a proposed recommendation from observed workload recovery.
- Include the updated offline engine. Cloud capacity protection and optional secondary challenges run in the shared service.

## 1.4.54

- Keep cited device faults and the final reviewer's requested evidence visible when a proposed root cause is rejected.
- Let slow cloud investigations try a second Argon account with the same context while retaining the original review window.

## 1.4.53
- Restore the original grid icon used by the existing VS Code Marketplace and Open VSX listings.
- Add a packaging check that rejects a different icon or extension identity.
- Synchronize the workspace's agent download checksum with the verified hosted download.
- Keep long question labels within narrow panels.
- Include the 1.4.52 clarification improvements and their release notes below.

## 1.4.52

- Answer clarification questions with three choices or your own text, followed by an explicit Submit answers button.
- Show the recommended next check first. Questions about what happened never recommend an unobserved answer.
- Highlight selected answers in orange, with keyboard navigation and readable light, dark and high-contrast styling.
- Keep connected follow-up questions and new evidence attached to the original incident and conversation.
- Ask for actual evidence after selecting a check. Choosing a check does not mean it ran or passed.
- Preserve typed answers and pending evidence when a request needs to be retried or an upload preview is cancelled.
- Preview and approve cloud follow-up uploads before sending. Local-only mode continues to block cloud uploads.
- Update the bundled offline engine to share the same clarification contract as the website and API.

## 1.4.51

- Require an editable preview and explicit approval before cloud review, including when the local engine is unavailable.
- Keep cloud review, copy, feedback and recovery actions attached to the displayed incident.
- Bring the finding, evidence and next check above detailed remediation. Keep real checkpoint warnings ahead of cloud actions.
- Preserve a pending incident securely when requesting a company evaluation, with a 24-hour expiry and explicit resumption.
- Add voluntary local feedback drafts and content-free automated review signals. Accuracy remains unverified until supported by evidence.
- Respect the editor telemetry setting and remove automatic analytics-consent prompts.
- Update the shared offline evidence engine and preserve existing Marketplace keywords. The Open VSX package adds Kubernetes.

## 1.4.39

- Add a single-play local-diagnosis GIF near the top of the listing, using real engine output and synthetic logs.
- Add NCCL to the title and focus two keyword slots on NCCL timeout and log analysis.
- Offer the protected free web diagnosis flow or account connection after the immediate editor cloud pass.

## 1.4.38

- State free local diagnosis on the first-use screen and distinguish optional cloud and connected plans.
- Explain that local diagnosis remains free when the optional Team trial ends.

## 1.4.37

- Refresh Marketplace images for the current Console, Fleet queue, cluster map and device inspector.
- Identify synthetic example telemetry and explain connected-account behavior in screenshot captions.

## 1.4.36

- Hide trial promotion for connected accounts that are not eligible.

- Refresh the selected host's full device details after compact map polling, so identity fields remain available.
- Keep hover summaries compact on narrow screens; full workload details remain in the inspector.

## 1.4.35

- Put local GPU artifact inspection beside the primary log-input paths.
- Explain trial email eligibility before starting account onboarding.
- Separate the Team cloud allowance from live Fleet plan eligibility.
- Use a neutral optional-cloud action label instead of promising a free review to every account state.

## 1.4.34

- Make Fleet incidents and the GPU host map discoverable from the sidebar.
- Explain the optional Team evaluation, work-email verification and plan boundaries next to its entry point.
- Remove the duplicate trial entry from the command palette while preserving its compatibility command.
- Correct disconnected workspace wording and improve accent text in light editor themes.
- Include the shared device inspector with signal explanations, default identity and measurements, contextual evidence tools and measured hover positioning.

## 1.4.33

- Add a brief attention pulse followed by a steady highlight, with reduced-motion support.
- Keep fleet counts and identities derived from telemetry; hide the cluster filter when only one cluster is connected.


## 1.4.32

- Restore the transparent Denpex wordmark in light, dark and contrast editor themes.
- Use the shared Fleet workspace with immediate cached filtering, confirmed search loading states and clearable filters.
- Add Fleet Atlas host groups, attention focus and GPU evidence drill-down with normal page scrolling.
- Keep historical hardware report counts separate from live GPU inventory.


## 1.4.31

- Replaces incident result pages with a bounded, searchable list and failure-type filters.
- Searches open incidents across the account and fetches the selected incident's recorded guidance.
- Adds visible entry points for all seven GPU diagnostics and validates local inspection summaries before preparing Console.
- Adds saved NCCL benchmark history and measured report detail in the shared workspace.
- Preserves the R32 engine and recovery evidence safeguards.

## 1.4.30

- Adds the shared fleet hierarchy: clusters, hosts, then GPU cards, with breadcrumbs and direct attention-signal focus.
- Keeps the complete GPU overview available without pagination or dropping reported devices.
- Organizes selected-device detail into Summary, Evidence and Metrics sections.
- Preserves the R32 diagnosis engine, account access, telemetry boundaries and manual Console preparation.

## 1.4.27

- Preserves the audited 1.4.26 R32 engine fixes, allocator compatibility checks, operation intake, missing-evidence states and checkpoint safety qualification.
- Adds bundled read-only GPU artifact inspection for Flight Recorder JSON, memory snapshots, Nsight SQLite, checkpoint candidates and repeated rank timings.
- Adds artifact measurement tables and shared cloud history while preserving saved investigations and cloud incident monitoring.
- Uses server-confirmed account identity and existing plan/trial allowances. Local analysis remains private and account-free.


## 1.4.26

- Updated to the shared R32 engine. Checkpoint candidates require integrity and workload-state checks regardless of the recommendation wording.
- Kept missing distributed and node observations in the needs-evidence state.
- Preserved negative numerical checks without inventing checkpoint contamination.
- Required allocator compatibility facts across classification labels and prevented negative ECC/Xid observations from becoming hardware evidence.
- The 1.4.25 candidate was prepared and locally installed but not published to Marketplace.

## 1.4.25

- Updated the shared R28 engine so a numerical failure alone does not assert that an unsaved checkpoint is contaminated.
- Kept an earlier verified checkpoint distinct from later numerical failure evidence.
- Cloud incident history now describes a previous diagnosis without claiming that its recommendation worked.
- Recognized copied CUDA exception messages without requiring the Python exception class prefix.

## 1.4.24

- Recognized the native CUDA dtype and disconnected-gradient exception wording captured on an RTX 4090.
- Updated the shared engine identity to R27. The 1.4.23 candidate was prepared but not published to Marketplace.

## 1.4.23

- Updated to the shared R26 operation-evidence engine. Exact operation failures no longer fall through to unrelated framework advice.
- Preserved manual numerical recovery guidance without claiming an automated check passed.
- Qualified shared optimizer changes, unknown causes and checkpoint preservation.
- Kept local diagnosis offline. Cloud and local review remain distinct capabilities.

## 1.4.22

- Added an optional own-incident evaluation entry in account navigation. It opens the existing website journey without uploading a log, connecting a workload or changing local diagnosis.
- Explained the specific reason for optional cloud review and displayed the recorded missing-fact questions before the handoff. Reopened reports request the original log instead of implying that it was retained.
- Retained the R25 diagnosis engine and all 1.4.21 local investigation improvements.

## 1.4.21

- Collapsed the large log composer after diagnosis so the report is visible first. The composer remains available for another log or a follow-up.
- Added a clear distinction between a recommendation and established workload recovery.
- Separated log submission from compact local follow-ups beneath the report.
- Added explicit local report save, export, reopen and deletion, with disclosure before writing evidence excerpts to the extension host.
- Added operator-reported recovery assessments and preserved assessment history, including unsuccessful attempts.
- Kept generic checkpoint uncertainty secondary for inference reports without hiding actual corruption warnings.
- Moved account and fleet navigation into a secondary section.
- Improved narrow layouts, keyboard navigation, light-theme hover fallback and forced-colors styling.
- Added document titles and corrected sidebar secondary-text contrast.

## 1.4.20

- Updated the shared engine to R25 with specific training-loop and reference-state evidence requests for uncertain numerical failures.
- Kept version metadata and current download links synchronized with the packaged extension.

## 1.4.19

- Corrected client identity metadata for the R24 package.

## 1.4.18

- Bundled the R24 workload-reference recovery engine.

## 1.4.17

- Aligned packaged diagnosis behavior and remedy qualification with the current shared release.

## 1.4.16

- Displayed remedy applicability, prerequisites and workload recovery checks in diagnosis reports.

## 1.4.15

- Connected accounts receive cloud diagnosis notifications with links to the saved analysis.
- Persisted notification deduplication separately for each connection. Failed polls retry without losing reports.
- Updated the offline engine and workload recovery evidence requirements.

## 1.4.14

- Added Open Console with an in-editor log composer and grounded local follow-ups for cause, evidence, fixes, verification, and checkpoint safety. Follow-ups read recorded findings and never invoke a model.
- Made an empty workspace log search offer a log file picker or clipboard diagnosis, with a distinct explanation when no project folder is open.
- Added a responsive console workspace with incident overview cards, investigation navigation, and open evidence and remediation panels.
- Corrected API client version reporting and refreshed message handlers when reusing the diagnosis tab.
- Embedded the website's shared Fleet dashboard and Topology map in editor panels. Account reads stay in the extension host; billing, key management and operational changes remain website actions.
- Kept failed telemetry reads distinct from empty fleets, preserved plan upgrade notices and prevented cluster-bound keys from reading account-wide fleet reports.
- Replaced the command list in the Denpex sidebar with clear actions for copied logs, editor or terminal output, workspace logs, and bundled samples.
- Opened local diagnoses in a full editor tab with the likely cause, safety guidance, supporting evidence, and next actions in reading order.
- Kept run buttons off remediation plans when a checkpoint safety warning is present.
- Updated the Marketplace listing with a screenshot captured from the extension running in VS Code.

## 1.4.13

- Shortened the Marketplace listing around trying a diagnosis, retained discovery keywords, and clarified the sample-image provenance.
- Made every getting-started action available directly in the walkthrough description, including narrow editor layouts.
- Replaced outdated trial key-copy instructions with the activation and Connect Account flow. Manual keys remain an advanced option.
- Updated the offline engine with source-backed TensorRT-LLM FP8 guidance covering Ada support and backend and model limitations.

## 1.4.12

- Added Connect Account: approve a short code in the browser and return to VS Code without copying an API key. An active eligible plan or approved trial is still required.
- Connection credentials stay in SecretStorage, expire after 90 days, and cannot change billing or execute remote commands. Disconnect Account revokes the current credential on the server.
- Kept diagnosis context in the editor while connecting. Connection never uploads a log or starts a paid analysis.
- Split trial instructions into clear activation and connection steps. Manual API key setup remains available for advanced and self-hosted use.
- Clarified that incomplete logs may require more evidence before identifying an initiating failure.

## 1.4.11

- Rebuilt the packaged offline engine from the verified website release, including the source-backed Xid 79 correction.
- Synchronized the published extension with the current consent-based funnel, in-editor Team evaluation request, and copy-first remediation controls.
- Included the canonical engine fingerprint so the public VSIX can be checked against the release source.

## 1.4.10

- The packaged sidebar now says Team rather than Scale for the 30-day evaluation.
- Rebuilt the bundled offline engine from the current diagnosis source and kept the reported client version in sync with the package.
- Added optional, consent-based counts for completed sample, own-log, cloud, and Team-trial steps. No log, result, email, path, machine detail, or install identifier is sent.

## 1.4.9

- The first local result leads with diagnosing your own log, then offers one optional cloud review of that same log. The cloud handoff explains when the log leaves VS Code.
- Free-form fix and verification text can be copied but no longer has an Execute button. Only structured remediation commands can be run directly.
- The trial action says Team and requests the code inside VS Code. The emailed link still handles activation, with key setup on denpex.com.
- Established company mailboxes can activate Team after an address-bound code and current domain checks without depending on Google Workspace. Uncertain domains receive a review path.
- The bundled engine is rebuilt from the current source so the published package can be checked against the repository.

## 1.4.8

- The bundled offline engine requires explicit evidence before naming missing torchrun ranks, FSDP desynchronization, or another rank as the cause of a generic NCCL communicator abort. When the initiating cause is absent, it asks for more evidence.
- The offline diagnosis engine version now matches the website's updated engine.

## 1.4.7

- The public 30-day evaluation now activates Team, matching the $499 month-to-month plan. Existing Scale codes still redeem at their original tier, and larger teams can request a reviewed Scale evaluation.
- Trial labels and cloud quota guidance in the extension match the website and emailed offer.

## 1.4.6

- Release package for the 30-day evaluation funnel shared by VS Code and denpex.com. The local diagnosis, one immediate account-free cloud analysis, email activation, and personal API key setup follow the same steps on both surfaces.

## 1.4.5

- Trial handoff: Request a Scale evaluation code in VS Code, then activate it through the emailed redemption link with the same work address. The extension now explains the website step and the 7-day redemption window instead of implying the trial starts inside the editor.
- Marketplace and website parity: The extension walkthrough, diagnosis panel, and listing describe the same 30-day evaluation path.
- Cloud allowance honesty: The extension offers one immediate account-free cloud analysis. Further anonymous analyses may require a browser check, so the extension directs users to the browser or to the Scale trial instead of promising three headless passes.
- Secure VS Code connection: After redeeming the trial, create an API key in Dashboard > Monitoring, copy it once, and paste it into VS Code SecretStorage. The trial code is never used as a cloud credential.

## 1.4.4

- Funnel Attribution: Every link the extension opens on denpex.com now carries campaign parameters naming the in-editor surface the click came from, so the path from Marketplace install to site visit to trial is measurable for the first time. Links to any other host are never rewritten, and a user-configured on-prem or air-gapped API endpoint is left untouched. Existing query strings survive, which trial code redemption depends on.
- Accurate Client Version Reporting: The version this extension reported to the API was hardcoded at 1.4.0 and never updated through 1.4.1, 1.4.2 and 1.4.3, so four releases of traffic were indistinguishable and per-release error rates could not be answered. It now reports its real version, and a parity test fails the build if the reported version and the package version ever disagree again.
- Shareable Incident Reports: The incident report text copied out of the diagnosis panel carries its own attribution, so a report pasted into Slack or a pull request is traceable back to the extension that produced it.

## 1.4.3

- Marketplace SEO & Remote Execution: Enabled remote workspace execution for Remote-SSH and GPU dev containers; added marketplace Q&A and verified status badges.
- Curated Keyword Set: Optimized extension keywords to the maximum allowed 30 high-impact tags across PyTorch, CUDA, distributed training, and LLM fine-tuning.
- Expanded Long-Tail Search Index: Added discoverability index covering modern GPU architectures, cloud providers (RunPod, Lambda, CoreWeave), and inference engines.

## 1.4.2

- Marketplace Search & Discovery: Expanded search indexing for PyTorch, CUDA error codes, multi-GPU training, and LLM fine-tuning failures.
- SEO Error Index: Added indexed error signature reference in extension documentation for instant diagnosis lookups.

## 1.4.1

- Brand & Logo Refresh: Replaced early beta pulse icons with the official Denpex 3x3 GPU cluster die grid logo across the extension marketplace, details page, and VS Code activity bar.
- Clean Status Bar Display: Removed obsolete pulse glyphs from the status bar in favor of clean text status reporting local engine availability and remaining cloud passes.
- Action Icon Update: Updated editor tab diagnostic icons with the signature Denpex orange cross accent.

## 1.4.0

- Local-First Default Architecture: All routine diagnoses run locally on the bundled offline engine in 400ms for free forever with zero server spend and zero token waste.
- 3 Cloud Deep Reasoning Passes: Cloud LLM multi-node reasoning is reserved on-demand for complex cluster crashes via a prominent action button, protecting free passes from being wasted on trivial test errors.
- Interactive Clickable Clarifying Questions: Clarifying questions in the diagnosis panel are now interactive multiple-choice buttons with recommended actions highlighted, enabling instant one-click diagnosis refinement.
- Zero-Prompt Terminal Link Clicks: Clicking a detected error link in any terminal immediately runs diagnosis on the clicked line and context without prompting "where are the crash logs?".
- Expanded Error Pattern Coverage: Terminal error detection coverage more than doubles across real-world ML crash logs, adding support for PyTorch RuntimeError, Horovod, Torchrun ChildFailedError, Ray, vLLM, and Slurm cancellations.
- Single Reused Webview Tab: Prevents editor clutter by reusing and revealing the existing diagnosis tab rather than opening multiple duplicate tabs.
- "Insert at Terminal Prompt" ($): Added staged command insertion button alongside Execute and Copy, allowing cautious engineers to stage remediation commands at their shell prompt without executing.
- Quick Diagnostics Status Bar Menu: Clicking the status bar item opens a quick-pick menu for clipboard diagnosis, workspace Slurm log scans, demo failures, and trial unlocks.

## 1.3.9

- Adds interactive Terminal Link Provider (DenpexTerminalLinkProvider). CUDA OOM, NCCL timeouts, Xid crashes, and vLLM errors in any terminal output become one-click clickable diagnosis links.
- Introduces frictionless in-editor work email trial flow. Users can activate the 30-day Scale evaluation (50 cloud diagnoses/day + fleet telemetry) directly inside VS Code without browser redirects.
- Adds one-click post-mortem export button ("Copy Slack/PR Report") in the diagnosis panel for sharing incident root cause and fixes with team channels.
- Expands Marketplace metadata and discovery keywords for H100, A100, B200, vLLM, DeepSpeed, Unsloth, Axolotl, and Torchtune.
- Embeds the 64-GPU distributed training incident flow directly into the extension overview.

## 1.3.8

- Opens the real Getting Started walkthrough on first install and offers one-click actions
  to diagnose a realistic 64 GPU failure or use the engineer's own log immediately.
- Aligns the Marketplace page and in-extension upgrade path with the 30-day Scale
  evaluation, including up to 50 cloud diagnoses a day, saved history, and fleet findings.
- Keeps local diagnosis unlimited, offline, and account-free. The paid prompt appears only
  after Denpex has returned useful local evidence.

## 1.3.7

- Bundles engine `2026.08.26+trial-control-arm-r16`. An independent audit defeated 1.3.6's
  new control-arm rule in both directions. Both defects were real and both are fixed.
- **A real hardware fault was being silenced.** The rule refused to trust a hardware verdict
  when your log showed the same silicon behaving under different software, but it only knew
  the ECC spelling "uncorrectable". The Linux kernel writes "AER: Uncorrected (Fatal)" for a
  fatal PCIe error, so that case slipped through and a genuine physical fault was reported as
  a software problem. That is the worse direction: it sends you after a driver while a card
  degrades.
- **A software fault was being reported as hardware.** The same rule matched on the words
  alone, so a log where you quoted a manual or pasted an unrelated historical line containing
  "uncorrectable" pinned the answer back to the wrong 88% hardware verdict that 1.3.6 exists
  to prevent. Damage evidence now only overrides the comparison when a tool emitted it
  (kernel, NVRM, nvidia-smi, DCGM, pcieport, AER), never when it appears in prose.
- The offline pattern database grows to 718 entries, adding NVLS and NCCL NVLS invalid
  argument signatures.
- Version bump is REQUIRED, not cosmetic: 1.3.6 was published carrying the r14 engine and the
  repository has since moved to r16, so the Marketplace build and the source disagreed about
  what 1.3.6 contains. Marketplace versions are immutable, so 1.3.6 keeps its original
  contents and this ships as 1.3.7.

## 1.3.6

- Bundles engine `2026.08.24+cycle10-repair-r14`. A controlled comparison in your log now
  outranks the "stronger lower layer wins" rule. A display wedge that reported a GSP
  firmware fault at 88% confidence, on a log stating three times that the same GPU is fine
  under X11, fine on a bare TTY, and fine on the proprietary driver of the same version, is
  no longer reported as a committed hardware verdict. Firmware faults do not depend on which
  compositor is running, and a wrong hardware verdict sends you to replace a healthy card.
- An answer the engine is not fully confident about now keeps the reasoning that justified
  it. Previously the explanation was replaced with "these logs don't contain the hard
  evidence", so a correctly-identified failure arrived as a bare error-class name with no
  why. The uncertainty is still stated plainly and the follow-up checks are still requested.
- Version bump is REQUIRED, not cosmetic: 1.3.5 was published carrying the previous engine
  and the repository has since moved to r14, so the Marketplace build and the source
  disagreed about what 1.3.5 contains. Marketplace versions are immutable, so 1.3.5 keeps
  its original contents and this ships as 1.3.6.

## 1.3.5

- Bundles engine `2026.08.24+cycle9-repair-r12`. Deep diagnoses now SHOW THEIR WORK.
  The engine returns the log lines that justify a verdict under a ranked structure, and
  nothing previously mapped those back to the field the UI reads, so a diagnosis named a
  cause and quoted nothing from your log. Measured across ten real incidents on two
  different models: evidence present on 0 of 10 answers before, 10 of 10 after.
- Every diagnosis ends with a short "what to do" block: the steps, how to confirm the fix
  worked, and the one thing to try if it did not. When the engine cannot name a cause it
  says so plainly and gives the narrowing step instead, rather than presenting a guess in
  the shape of a fix.
- A fix can now be verified. The engine is required to return a command that checks
  whether the remedy worked, which was previously absent from every deep answer.
- Long answers are no longer truncated into a false "UNKNOWN". A response cut off
  mid-JSON used to degrade silently into an abstention with the summary
  "Analysis complete.", which is indistinguishable from the engine declining to answer.
- A verdict that does not explain the
  earliest device-level fault in the log is now capped and labelled downstream, instead
  of being reported at high confidence. On a vLLM worker killed by a cuBLAS SM90
  split-K GEMM fault, the extension previously led with the EngineCore teardown; it now
  leads with the kernel that actually faulted.
- The offline triage path names the component the log itself names, and treats a
  control experiment already present in the log as evidence rather than asking you to
  run it again.
- The engine's internal annotations no longer appear as quoted evidence. A
  `[SYSTEM_WARNING] This job may not have crashed` line could previously be shown as
  the first evidence on a log that had plainly crashed.
- Version bump is required rather than cosmetic: a repo-wide punctuation sweep changed
  the bundled payload while the manifest still read 1.3.4, so the published 1.3.4 and
  the repository disagreed about what 1.3.4 contains. Marketplace versions are
  immutable, so 1.3.4 keeps its original contents and this ships as 1.3.5.

## 1.3.4

- Reissued the reviewed r9 build after the Marketplace's immutable 1.3.3 upload was
  found to contain an older engine artifact.
- Bundles engine `2026.08.24+cycle8-revealed-r9` and its current behavior fingerprint.

## 1.3.3

- Updated the bundled canonical offline engine and pattern database to the current
  source fingerprint.
- Moved cloud API keys into VS Code SecretStorage and migrate legacy plaintext settings
  without weakening local/offline diagnosis.
- Replaced heuristic pre-crash confidence percentages with evidence-labelled severity.
- Kept the walkthrough, sample diagnoses, editor/terminal actions, sidebar, and final
  Marketplace SEO overview from 1.3.2.

## 1.3.2

- Rewrote the Marketplace overview around searchable GPU/ML failure terms and the
  under-60-second first-install experience.
- Clarified that local diagnosis is unlimited, offline, and requires no account or
  system Node.js installation.
- Documented every in-editor discovery surface, included sample, and supported runtime.

## 1.3.1

- Added an install-time walkthrough with an offline NCCL cascade diagnosis.
- Added five one-click sample failures for NCCL, Xid, Kubernetes, and vLLM incidents.
- Added editor, selection, terminal, and editor-title diagnosis actions.
- Added a Denpex sidebar with current logs, recent local diagnoses, samples, and privacy status.
- Added a visible cloud-escalation action to local diagnosis reports.
- Clarified that local diagnosis is unlimited; only optional cloud use is metered.
- Added Marketplace discovery metadata and support resources.

## 1.3.0

- Bundled the canonical deterministic engine for unlimited offline diagnosis.
- Added local-first engine selection and explicit cloud deep reasoning.
- Added calibrated confidence, causal-chain, checkpoint-safety, and remediation reporting.




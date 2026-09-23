# OrbitFS Release Control — Staged Roadmap

## Stage 1 — Dev Panel
- [x] Responsive Release Control interface
- [x] Separate Base Release and Engine Update workspaces
- [x] Base source inspection from `base-release`
- [x] Engine source inspection from `UPDATE_RELEASE`
- [x] Latest approved release/source baseline detection
- [x] SemVer release entry with next-patch helper
- [x] Release channel selection
- [x] Automatic change detection
- [x] Generated Base Deployment Log / Update Changelog
- [x] Editable changelog review gate
- [x] GitHub workflow dispatch with release metadata
- [x] Live workflow/job monitoring
- [x] License Master handoff monitoring
- [x] Release/activity history
- [x] Read-only source/configuration status
- [x] Stage 1 stops before publication

## Stage 2 — Custom License Manager
- [ ] Receive Dev Panel release candidates
- [ ] Validate release manifests/artifacts
- [ ] Validate Base/Engine compatibility and licensing rules
- [ ] Approve/reject candidates
- [ ] Provide accepted releases to Billing Store

## Stage 3 — V2_Billing_Store Admin Portal
- [ ] Receive approved License Manager releases
- [ ] Admin review/customisation
- [ ] Channel/access configuration
- [ ] Publish releases

## Stage 4 — Customer Portal
- [ ] Keep existing Base Deployer for new installations and major Base deployments
- [ ] Build Frontend Updater for existing installations
- [ ] Apply Engine/addon updates
- [ ] Apply supported Base-system incremental changes
- [ ] Track installed versions and update state

## Release systems
### Base Deployment
`V1-vercel-base` / `base-release` → Dev Panel → License Manager → Billing Store Admin → Customer Portal Base Deployer

### Update Release
`V1-vercel-engine` / `UPDATE_RELEASE` → Dev Panel → License Manager → Billing Store Admin → Customer Portal Frontend Updater

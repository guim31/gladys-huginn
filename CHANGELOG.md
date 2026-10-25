# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- First version: your Huginn agents in Gladys (Gladys 5.1.0 or later). The
  integration signs in with a Huginn account (Huginn has no API key) and reads
  the instance at the chosen interval (30 s to 5 min).
- One device per agent: working, last event (excerpt), last event date, events
  kept, error message. One Huginn device: agents, agents in error, disabled
  agents, events in 24 h, failed jobs (5 days).
- Scene triggers: an agent creates an event (with an excerpt and the content in
  JSON), an agent falls in error (with its message), Huginn is unreachable,
  Huginn answers again.
- Scene actions: send an event to Huginn (a Webhook Agent, text or JSON), run a
  Huginn agent, last event of an agent (with a ready-made sentence).
- Dashboard widget "Huginn events": agents in error first, then the last event
  of each agent.
- Documentation in English, French, German and Spanish.

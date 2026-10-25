# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration holds and where:

- the Huginn address, username and password, in the configuration of the
  integration, stored by Gladys (the password in a secret field); the password
  is sent only to the sign-in form of Huginn, and never logged;
- the session cookie of Huginn, in memory only;
- the secret of each Webhook Agent, read from Huginn at every refresh, kept in
  memory and used only in the address of that agent; never published to Gladys
  nor logged;
- `/data/huginn-state.json`: the highest event id seen, the last event of each
  agent (excerpt and up to 1000 characters of its content), the newest error
  message of each agent, the event counts of the last 24 hours. Delete it to
  start afresh (nothing is announced at the first read after).

Network: the integration talks only to the Huginn address configured, over
HTTP or HTTPS (a self-signed certificate is accepted only when the option is
ticked). It opens no port.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and the third-party services and devices the integration talks to.

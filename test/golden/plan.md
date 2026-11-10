<!-- promptplan -->
### promptplan plan

target: practice mock (test) · labels: from files

**Plan: 1 to create, 1 new version, 1 label move, 2 unchanged**

| | Prompt | Change |
|:-:|---|---|
| `=` | `faq/short` | unchanged v1 (labels: production) |
| `=` | `legal/disclaimer` | unchanged v3 (labels: production) |
| `+` | `onboarding/welcome` | create v1 (labels: staging) |
| `>` | `qa/answer` | move production v1 → v2 |
| `~` | `support/greeting` | new version v3 (labels: staging) |

**Warnings**

- drift legal/disclaimer: latest v4 was created outside promptplan (commit message: "Edited in the Langfuse UI") and is not in your files — review it in Langfuse or copy the change into legal/disclaimer.md
- qa/answer: placeholder added: history (compared with v1) — callers must now fill it
- support/greeting: variable removed: topic (compared with v2) — callers passing it will be ignored

<details><summary><code>onboarding/welcome</code> — create v1 (labels: staging)</summary>

```diff
--- (new prompt)
+++ onboarding/welcome.md
@@ -0,0 +1,5 @@
+Welcome to {{product}}, {{name}}!
+Here are three things you can try first:
+1. Ask a question in plain words.
+2. Paste an error message.
+3. Ask for an example.
```

</details>

<details><summary><code>qa/answer</code> — move production v1 → v2</summary>

```diff
--- qa/answer v1
+++ qa/answer v2
@@ -1,4 +1,5 @@
 [system]
-You answer questions about {{product}}.
+You answer questions about {{product}}. Keep answers short and cite the docs page.
+[placeholder: history]
 [user]
 {{question}}
```

</details>

<details><summary><code>support/greeting</code> — new version v3 (labels: staging)</summary>

```diff
--- support/greeting v2
+++ support/greeting.md
@@ -1,1 +1,1 @@
-Hi {{name}}! What do you need help with regarding {{topic}}?
+Hi {{name}}! What do you need help with today?
```

</details>

Not in your files (left alone): `experiments/tone-test`

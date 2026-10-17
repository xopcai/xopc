# DeepSeek Search

Configure your own DeepSeek Search key in **Settings → Search** or with the CLI:

```bash
export DEEPSEEK_API_KEY='your-key'
xopc search add deepseek --key DEEPSEEK_API_KEY
xopc search list
```

Omit `--key` to enter the key through the secure prompt. An optional `--url https://proxy.example/v1` selects a compatible HTTPS API base URL; the default is `https://api.deepseek.com`. API URLs accept an origin with optional `/v1`, without credentials, query strings or fragments.

Equivalent configuration:

```json
{
  "tools": {
    "web": {
      "search": {
        "maxResults": 5,
        "providers": [{ "type": "deepseek", "apiKey": "DEEPSEEK_API_KEY" }]
      }
    }
  }
}
```

The environment variable must be set in the process running xopc. Adding a DeepSeek chat model does not automatically enable paid search.

Search queries support up to 128 Unicode characters. xopc requests summaries without page bodies, preferring `summary` over `snippet`. Fetch remains unchanged. The current tool limit is 20 results for direct search and 10 for cloud search.

Enabled and usable manual search providers are tried in configured order, followed by the existing regional HTML fallback. Without a usable manual provider, xopc automatically tries advertised XOPC Cloud search before HTML. Existing authentication/permission refusals stop the request. To return to automatic cloud search, disable or remove your usable manual entries:

```bash
xopc search remove deepseek
```

For platform-managed DeepSeek, administrators configure **Cloud search** in xopc-platform. Clients use their existing XOPC Cloud OAuth connection; they do not receive the upstream API key.

Expand a chat search step to see its actual provider, cloud upstream and cache status. Collapsed steps keep their existing summary. Developer view adds attempt counts and the fallback route. Cached results show their original provider; old history without provenance is marked unknown rather than inferred from current settings. Compact search metadata is retained when large result details are trimmed.

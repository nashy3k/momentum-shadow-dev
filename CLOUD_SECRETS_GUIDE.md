# Momentum Cloud Deployment: Secret Management

To finish the deployment, we need to securely store your API keys in the cloud.

## 1. Set Secrets in Firebase
Run these commands one by one to store your keys. This is safer than using .env files.

```bash
firebase functions:secrets:set GOOGLE_API_KEY
firebase functions:secrets:set OPIK_API_KEY
firebase functions:secrets:set DISCORD_TOKEN
firebase functions:secrets:set GITHUB_TOKEN
```

## 2. Deploy again
After setting the secrets, your script will work:

```powershell
.\deploy.ps1
```

# DeepAudit Backend

AI-powered codebase interrogator.

## Deployment on Railway

1. **Push to GitHub**: (Already initialized).
2. **Login to [Railway](https://railway.app/)**.
3. **Create a New Project**:
   - Select "Deploy from GitHub repo".
   - Choose the `DeepAudit` repository.
4. **Configure Environment Variables**:
   - Go to the **Variables** tab in your Railway service.
   - Add `GEMINI_API_KEY`: Your Google AI SDK key.
   - (Optional) Add `GITHUB_TOKEN`: A personal access token to avoid rate limits.
5. **Deploy**: Railway will automatically detect the `package.json` and run `npm start`.

## API Endpoints

### `POST /api/audit`
- **Body**: `{"repoUrl": "https://github.com/owner/repo"}`
- **Returns**: `githubStats` (Aggregated JSON) and `aiReport` (Markdown string).

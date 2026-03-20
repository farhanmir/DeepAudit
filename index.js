const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Malformed JSON payload. Check your quotes.' });
  }
  next();
});
app.use(cors());

app.get('/', (req, res) => {
  res.send('DeepAudit Data Aggregator is Live! (Vercel Bridge Mode)');
});

function extractRepoInfo(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'github.com') return null;
    
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    
    return {
      owner: parts[0],
      repo: parts[1].replace(/\.git$/, '')
    };
  } catch (err) {
    return null;
  }
}

app.post('/api/audit', async (req, res) => {
  const body = req.body || {};
  const { repoUrl } = body;
  
  if (!repoUrl) {
    return res.status(400).json({ 
      error: 'repoUrl is required in the JSON body.',
      receivedBody: body 
    });
  }

  const repoInfo = extractRepoInfo(repoUrl);
  if (!repoInfo) {
    return res.status(400).json({ error: 'Invalid GitHub repository URL provided.' });
  }

  const { owner, repo } = repoInfo;

  try {
    const headers = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'DeepAudit-App'
    };

    if (process.env.GITHUB_TOKEN) {
      headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
    }

    const endpoints = [
      `https://api.github.com/repos/${owner}/${repo}`,
      `https://api.github.com/repos/${owner}/${repo}/commits?per_page=50`,
      `https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=20`
    ];

    const [baseRes, commitsRes, pullsRes] = await Promise.all(
      endpoints.map(url => fetch(url, { headers }))
    );

    if (!baseRes.ok || !commitsRes.ok || !pullsRes.ok) {
      const status = baseRes.status !== 200 ? baseRes.status : 
                     (commitsRes.status !== 200 ? commitsRes.status : pullsRes.status);
      
      const failingRes = baseRes.status !== 200 ? baseRes : 
                         (commitsRes.status !== 200 ? commitsRes : pullsRes);
      
      const errorData = await failingRes.json().catch(() => ({}));
      
      let message = 'Failed to fetch repository data from GitHub.';
      if (status === 404) message = 'Repository not found or is private.';
      if (status === 403 || status === 429) message = 'GitHub API rate limit exceeded. You likely need a GITHUB_TOKEN on Vercel.';
      
      return res.status(status >= 500 ? 500 : 400).json({ 
        error: message, 
        githubStatus: status,
        githubError: errorData
      });
    }

    const baseData = await baseRes.json();
    const commitsDataBody = await commitsRes.json();
    const pullsDataBody = await pullsRes.json();

    const commitsList = Array.isArray(commitsDataBody) ? commitsDataBody : [];
    const pullsList = Array.isArray(pullsDataBody) ? pullsDataBody : [];

    // --- Process Commits ---
    const badPatterns = /\b(fix|wip|update|fuck|shit|damn|crap|test)\b/i;
    let badCommitCount = 0;
    let directPushes = 0;
    const worstCommits = [];

    // Check if pushed directly to default branch by seeing if any commit came from PR?
    // We strictly look for "bad" patterns to fulfill the 'bad commit messages' requirement
    commitsList.forEach(c => {
      const msg = c.commit.message || "";
      const firstLine = msg.split('\n')[0];
      
      // Heuristic for direct pushes to default branch: 1 parent and not a standard PR merge pattern
      if (c.parents && c.parents.length === 1 && !msg.toLowerCase().includes("merge pull request") && !msg.includes("(#")) {
        directPushes++;
      }

      if (badPatterns.test(firstLine) || msg.length < 5) {
        badCommitCount++;
        if (worstCommits.length < 5) {
          worstCommits.push({
            hash: c.sha.substring(0, 7),
            message: firstLine,
            author: c.commit.author?.name
          });
        }
      }
    });

    // --- Process Pull Requests ---
    let stalePrcount = 0;
    let oldestPrAgeDays = 0;
    const now = new Date();

    pullsList.forEach(pr => {
      const prDate = new Date(pr.created_at);
      const diffTime = Math.abs(now - prDate);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      if (diffDays > 14) {
        stalePrcount++;
      }
      if (diffDays > oldestPrAgeDays) {
        oldestPrAgeDays = diffDays;
      }
    });

    // Compile highly condensed roastMetrics object
    const roastMetrics = {
      repository: `${baseData.owner.login}/${baseData.name}`,
      created_at: baseData.created_at,
      updated_at: baseData.updated_at,
      open_issues: baseData.open_issues_count,
      commits_analyzed: commitsList.length,
      bad_commit_messages: badCommitCount,
      direct_pushes_to_branch: directPushes,
      worst_commits: worstCommits,
      stale_prs: stalePrcount,
      oldest_pr_age_days: oldestPrAgeDays
    };

    return res.status(200).json({ roastMetrics });

  } catch (error) {
    console.error('[Audit Error]', error);
    return res.status(500).json({ 
      error: 'An unexpected error occurred during the audit calculation.', 
      details: error.message 
    });
  }
});

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`DeepAudit server running on port ${PORT}`);
  });
}

module.exports = app;

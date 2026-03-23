require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

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
  try {
    const { repoUrl, githubToken } = req.body || {};
    if (!repoUrl) {
      return res.status(400).json({ error: 'repoUrl is required' });
    }

    const repoInfo = extractRepoInfo(repoUrl);
    if (!repoInfo) {
      return res.status(400).json({ error: 'Invalid GitHub repository URL' });
    }
    const { owner, repo } = repoInfo;

    const headers = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'DeepAudit-App'
    };

    const token = githubToken || process.env.GITHUB_TOKEN;
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const baseUrl = `https://api.github.com/repos/${owner}/${repo}`;
    const endpoints = [
      baseUrl,
      `${baseUrl}/commits?per_page=30`,
      `${baseUrl}/pulls?state=open&per_page=50`,
      `${baseUrl}/languages`
    ];

    const responses = await Promise.all(
      endpoints.map(url => fetch(url, { headers }))
    );

    for (const r of responses) {
      if (!r.ok) {
        if (r.status === 401) {
          return res.status(401).json({ error: 'Unauthorized — private repo or bad token' });
        }
        if (r.status === 404) {
          return res.status(404).json({ error: 'Repository not found' });
        }
        if (r.status === 403) {
          return res.status(403).json({ error: 'GitHub rate limit exceeded' });
        }
        return res.status(r.status).json({ error: `GitHub API error: ${r.statusText}` });
      }
    }

    const [repoData, commitsData, pullsData, languagesData] = await Promise.all(
      responses.map(r => r.json())
    );

    let bad_commit_messages = 0;
    let direct_pushes_to_main = 0;
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const badCommitRegex = /^(fix|wip|update|test|oops|misc|\.{1,3}|changes|temp)$/i;

    const recent_commits = [];

    if (Array.isArray(commitsData)) {
      for (const commitObj of commitsData) {
        const msg = commitObj.commit?.message || '';
        const trimmedMsg = msg.trim();
        
        if (trimmedMsg.length <= 8 || badCommitRegex.test(trimmedMsg)) {
          bad_commit_messages++;
        }

        const commitDateStr = commitObj.commit?.author?.date;
        if (commitDateStr) {
          const commitDate = new Date(commitDateStr);
          if (commitObj.parents && commitObj.parents.length === 1 && commitDate >= ninetyDaysAgo) {
            direct_pushes_to_main++;
          }
        }

        recent_commits.push({
          message: msg,
          date: commitDateStr || '',
          author: commitObj.author?.login || commitObj.commit?.author?.name || ''
        });
      }
    }

    let stale_prs = 0;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    if (Array.isArray(pullsData)) {
      for (const pr of pullsData) {
        const createdAt = new Date(pr.created_at);
        if (createdAt < thirtyDaysAgo) {
          stale_prs++;
        }
      }
    }

    const roastMetrics = {
      repository: `${owner}/${repo}`,
      description: repoData.description || null,
      stars: repoData.stargazers_count,
      forks: repoData.forks_count,
      open_issues: repoData.open_issues_count,
      created_at: repoData.created_at,
      updated_at: repoData.updated_at,
      commits_analyzed: Array.isArray(commitsData) ? commitsData.length : 0,
      bad_commit_messages,
      direct_pushes_to_main,
      stale_prs,
      languages: languagesData || {},
      recent_commits
    };

    res.json({ roastMetrics });

  } catch (error) {
    console.error('Audit error:', error);
    res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

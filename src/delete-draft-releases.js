import fs from 'fs';
import * as core from '@actions/core';
import { setFailed } from '@actions/core';
import axios from 'axios';
import { context, getOctokit } from '@actions/github';

import parse from 'parse-duration';

async function validateSubscription() {
  let repoPrivate;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath && fs.existsSync(eventPath)) {
    const payload = JSON.parse(fs.readFileSync(eventPath, "utf8"));
    repoPrivate = payload?.repository?.private;
  }

  const upstream = 'hugo19941994/delete-draft-releases';
  const action = process.env.GITHUB_ACTION_REPOSITORY;
  const docsUrl = 'https://docs.stepsecurity.io/actions/stepsecurity-maintained-actions';
  core.info('');
  core.info('\u001b[1;36mStepSecurity Maintained Action\u001b[0m');
  core.info(`Secure drop-in replacement for ${upstream}`);
  if (repoPrivate === false) core.info('\u001b[32m\u2713 Free for public repositories\u001b[0m');
  core.info(`\u001b[36mLearn more:\u001b[0m ${docsUrl}`);
  core.info('');
  if (repoPrivate === false) return;
  const serverUrl = process.env.GITHUB_SERVER_URL || 'https://github.com';
  const body = { action: action || '' };
  if (serverUrl !== 'https://github.com') body.ghes_server = serverUrl;
  try {
    await axios.post(
      `https://agent.api.stepsecurity.io/v1/github/${process.env.GITHUB_REPOSITORY}/actions/maintained-actions-subscription`,
      body, { timeout: 3000 }
    );
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 403) {
      core.error(`\u001b[1;31mThis action requires a StepSecurity subscription for private repositories.\u001b[0m`);
      core.error(`\u001b[31mLearn how to enable a subscription: ${docsUrl}\u001b[0m`);
      process.exit(1);
    }
    core.info('Timeout or API not reachable. Continuing to next step.');
  }
}

function checkDuration(releaseDate) {
  if (process.env.INPUT_THRESHOLD) {
    const threshold = process.env.INPUT_THRESHOLD;
    const seconds = parse(threshold, 's'); // duration in seconds
    return new Date(releaseDate) < new Date(Date.now() - seconds * 1000);
  }
  // If not threshold has been specified all drafts will be deleted
  return true;
}

export default async function run() {
  try {
    await validateSubscription();

    const octokit = getOctokit(process.env.GITHUB_TOKEN || '');

    // Get owner and repo from context of payload that triggered the action
    const { owner, repo } = context.repo;

    // List all releases
    // API Documentation: https://developer.github.com/v3/repos/releases/#list-releases-for-a-repository
    // Octokit Documentation: https://octokit.github.io/rest.js/#octokit-routes-repos-list-releases
    const listReleasesResponse = await octokit.paginate(octokit.rest.repos.listReleases, {
      owner,
      repo
    });

    if (!listReleasesResponse || !Array.isArray(listReleasesResponse)) {
      throw new Error(`Error listing releases`);
    }

    if (listReleasesResponse.length === 0) {
      console.log('No releases found - make sure your token has `content: write` permissions');
      return;
    }

    console.log(`Found ${listReleasesResponse.length} releases`);

    const deleteTasks = [];
    listReleasesResponse.forEach((release) => {
      if (release.draft) {
        // Check if it meets the threshold
        if (checkDuration(release.created_at)) {
          // API Documentation: https://developer.github.com/v3/repos/releases/#delete-a-release
          // Octokit Documentation: https://octokit.github.io/rest.js/#octokit-routes-repos-delete-release
          console.log(`Deleting draft release ${release.id} created at ${release.created_at}`);
          deleteTasks.push(
            octokit.rest.repos.deleteRelease({
              owner,
              repo,
              release_id: release.id
            })
          );
        }
      }
    });

    const results = await Promise.all(deleteTasks);
    results.forEach((result) => {
      if (result.status !== 204) {
        throw new Error('Error deleting releases');
      }
    });
  } catch (error) {
    setFailed(error.message);
  }
}

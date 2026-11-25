import {
  basic,
  bearer,
  check,
  connection,
  count,
  error,
  fromPath,
  matchesState,
  positiveID,
  segment,
  service,
  verdict,
  workURL,
  z,
} from '@cairul/pdk';

export default function bitbucket(options) {
  const api = connection(options, {
    prefix: 'BITBUCKET',
    baseUrl: 'https://api.bitbucket.org/2.0',
    tokenEnv: 'BITBUCKET_TOKEN',
    authModes: { basic, bearer },
    defaultAuth: (email) => (email ? 'basic' : 'bearer'),
  });
  function pullRequest(shape, evaluate) {
    return check(
      z.strictObject({
        repository: z
          .string()
          .regex(/^[^/]+\/[^/]+$/)
          .optional(),
        number: positiveID.optional(),
        ...shape,
      }),
      (config, context) =>
        service(async () => {
          let { repository, number } = config;
          if (!repository || !number) {
            const [workspace, name, id] = fromPath(
              workURL(context.workItemUrl, ['bitbucket.org', api.host]),
              /^\/([^/]+)\/([^/]+)\/pull-requests\/(\d+)(?:\/|$)/
            );
            repository ??= `${workspace}/${name}`;
            number ??= id;
          }
          const path = `repositories/${repository.split('/').map(segment).join('/')}/pullrequests/${number}`;
          return evaluate(await api.request(path, { signal: context.signal }), config);
        })
    );
  }
  return {
    checkKinds: {
      'bitbucket.pr-merged': pullRequest({}, ({ state }) => matchesState(state, 'MERGED', 'Pull request')),
      'bitbucket.pr-approvals': pullRequest(
        { minimum: count.min(1).default(1) },
        ({ participants, author }, { minimum }) => {
          if (!Array.isArray(participants) || !author?.uuid)
            return error('Bitbucket returned incomplete review information.');
          const approved = new Set(
            participants
              .filter((p) => p.approved && p.user?.uuid && p.user.uuid !== author.uuid)
              .map((p) => p.user.uuid)
          ).size;
          return verdict(approved >= minimum, `${approved} of ${minimum} required approvals.`);
        }
      ),
    },
  };
}

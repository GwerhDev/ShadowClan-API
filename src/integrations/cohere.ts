import { CohereClient } from 'cohere-ai';
import { cohereSecret } from '../config';

const cohere = new CohereClient({ token: cohereSecret });

export async function aiCohere(query: string): Promise<string> {
  const prediction = await cohere.generate({
    prompt:    query,
    maxTokens: 400,
  });
  return prediction.generations[0].text;
}

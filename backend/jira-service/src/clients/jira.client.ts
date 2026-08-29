import axios, { AxiosInstance } from 'axios';

export class JiraClient {
  private getClient(domain: string, email: string, apiToken: string): AxiosInstance {
    const cleanDomain = domain.replace(/^https?:\/\//i, '').replace(/\/+$/, '').trim();
    const cleanEmail = email.trim();
    const cleanToken = apiToken.trim();
    const auth = Buffer.from(`${cleanEmail}:${cleanToken}`).toString('base64');
    return axios.create({
      baseURL: `https://${cleanDomain}`,
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
      },
      timeout: 10000,
    });
  }

  async fetchAssignedTickets(domain: string, email: string, apiToken: string) {
    const client = this.getClient(domain, email, apiToken);
    const jql = 'assignee = currentUser() ORDER BY updated DESC';
    const response = await client.post('/rest/api/3/search/jql', {
      jql,
      fields: ['*all'],
    });
    return response.data;
  }

  async getTicketDetails(domain: string, email: string, apiToken: string, ticketKey: string) {
    const client = this.getClient(domain, email, apiToken);
    const response = await client.get(`/rest/api/3/issue/${ticketKey}`);
    return response.data;
  }

  async validateCredentials(domain: string, email: string, apiToken: string) {
    const client = this.getClient(domain, email, apiToken);
    const response = await client.get('/rest/api/3/myself');
    return response.data;
  }
}

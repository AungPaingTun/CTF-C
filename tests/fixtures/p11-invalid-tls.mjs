import { createServer } from "node:https";

const key = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC6s17ZP0nnr3qu
S+qnwrKeEDZ9LEdC1ThpCFand5vzA4SDMSUiu/dtaxSPNpVkmDwOJ7nuOMTMPvR1
ZnpVAkjYurH3zmpFj2+HlANN9LL9xGRbNf/WNlHRYDph/yRmmxbJy24O5V/mb98t
jdc7hDjGFOanK8n1yYvDjE2dibGtaTI/94U9wKBZtVEWV8hoqHaBvtxU6HAzBV6Z
2JA3QNtql3fhF7jTTmEgvqxWG3CgPoZaSsk+olJz+U3UfBvKe89i9+BgrrZFKThk
XS9ywI+VoycEiXEgMTFlQfFgApaUMljz7m2cyVxaHYvhTMmFWcgkA4FW4AYL9cSd
TQHxAp7FAgMBAAECggEAQQoEhDzyc4YjgD2NIOUIEV1HhiKbLpKVxK01dsCJsMYs
bwF7VNbTUqhHcL6Mm48W+L1pHa5kDFzwD0fkXOHfW7TqE5AyYEogCcSLxCf3BMVa
SpYMqmSg6wYRQJs/5IipjyHRlNneJyoYvsdXT/H3TzXvxhPQltGf4T7quPNDVMuk
bdQV60/ZAiP8bZPIXt7ssl3pspggFAmpNohhYxKyArwPHfYqfW/NKaeLSnRSa3nd
ec4WOgJHuUcXBEems8sIsMstsJLPpuvwp6Ki/syAEWXgO1vxDRV2ceLLXEqjILy5
xtF9KOYWo9n7Bd6SqFvmflKH79EZwJYbwk/kZaTnDwKBgQDtrxgN/Z2w3roCbZJu
/6vBo/vdvkCA3bExpduCsptGTkv/cGBIL93WPZfNll0xjHA2XwNWzYEr8Yu3QvBq
1rSMeUdr4WWkxAlL87GdDxIXFDyRBKTrbGxG1+4DjFufI10b2K0AfaykCG/xicoR
QFVGg6XHtLRDG82lE8+jblnOawKBgQDJFoEn0AwxGAPibhROgmA15bujU0MGy3pu
iUF+ID0KxSKEMmy+oqmjbAh3a6qRoVhldVJKK0nvc+GW9PQI3nQ9b+wjBpxAAJxU
7aL4TkJOKoLi4o09oUMKXu/LJM6MswftXq1ByjWrLCKrM86gWlau2KN9bTYQxYPW
LSu65mszjwKBgQCGEKs6yQD3UMoOsItWPLQ+pyZb7wInLeTSokDsuZ3HzEYlsNc+
IHG6dEd52QR7/EEXCgSyI3xmsvohxoohWTXBvm7AtQRGKaUsyCo48tU7W1jGW55C
hIeWdhl0uui7HJFaMZ9zlW+ZnoC19wiZLnZrLbqGqLC84aPfJwuJnabePQKBgHMH
7qZJu0+yPzaeZftrVYI/gxExJhyS9dyZo990rbalgtNAzThYcNZNjKJT8uUP+TNA
4+wNy2OxVJE4Wwlfx/sFNX3r4CI0tzlWH24PxppUcz86/jUNNP6PxHje+1E9cQF2
sYH7HKxouQRaxI6yXvfyccPkX5NEieBRQrzN5vE9AoGBAIBy4KG+r+/e16QhUryq
QFVYYeUoQ4B6f7Ocv10Lpu6VrVFbp/cvwmPpCD7VuByWwnsoLYBMRXZYAf8gdcvr
Du9TDHnBHW9dW7ufqdwbEmCzxRd4B2z3CJZjQWt4HevRjAT9gZWwrOcntym/XC7a
0u3EgSQ2z8ruejoXW7e2NEMk
-----END PRIVATE KEY-----`;

const cert = `-----BEGIN CERTIFICATE-----
MIIDCTCCAfGgAwIBAgIUairDBcrqrCuYYzSjg4Y4SRkMD+IwDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJMTI3LjAuMC4xMB4XDTI2MDgwNTAzNDEzMVoXDTI2MDgw
NjAzNDEzMVowFDESMBAGA1UEAwwJMTI3LjAuMC4xMIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEAurNe2T9J5696rkvqp8KynhA2fSxHQtU4aQhWp3eb8wOE
gzElIrv3bWsUjzaVZJg8Die57jjEzD70dWZ6VQJI2Lqx985qRY9vh5QDTfSy/cRk
WzX/1jZR0WA6Yf8kZpsWyctuDuVf5m/fLY3XO4Q4xhTmpyvJ9cmLw4xNnYmxrWky
P/eFPcCgWbVRFlfIaKh2gb7cVOhwMwVemdiQN0Dbapd34Re4005hIL6sVhtwoD6G
WkrJPqJSc/lN1HwbynvPYvfgYK62RSk4ZF0vcsCPlaMnBIlxIDExZUHxYAKWlDJY
8+5tnMlcWh2L4UzJhVnIJAOBVuAGC/XEnU0B8QKexQIDAQABo1MwUTAdBgNVHQ4E
FgQUuMdpAFV5z39TwOiE9CczzuxkddYwHwYDVR0jBBgwFoAUuMdpAFV5z39TwOiO
9CczzuxkddYwDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAALwi
azfHPZ5jW0ikNuwGGMj+KXCpojVdBCfqy4S+DG3+3HN8Xugb4S3hPTVInivjUfa6
3BpCvmjZ6DXzzBGD9uiSDXzsfq3pH20YK7OBTy898xP821zWZREgBqvHAky1xLC+
44mR7Q1Hlib9ObaieeDDg+ZMS9os28TH9ZyOTMW38JvnoxAc/V3P355tuWKmK68L
wxdUf64NKNUV7zIXSRPYj3L3k1Lrw8gQ4F+wIQ6OjgxfE/wCItQ3cEve4h1UgNwv
gvdH2WdDQ+eIxBzacJ2kBT4nXLQ3rh2J8mHOHBq1W7FMPoDW8vYVf9AdqBVAFlFJ
uPCY4eaafdDqDty/+A==
-----END CERTIFICATE-----`;

export async function startP11InvalidTlsFixture() {
  const server = createServer({ key, cert }, (request, response) => {
    if (request.url === "/") {
      response.setHeader("set-cookie", "p11_session=fixture-session; Path=/");
      response.writeHead(200, { "content-type": "text/plain" });
      response.end('tls-fixture-ok <a href="/cookie">cookie</a>');
      return;
    }
    if (request.url === "/cookie") {
      response.writeHead(request.headers.cookie === "p11_session=fixture-session" ? 200 : 401, { "content-type": "text/plain" });
      response.end(request.headers.cookie === "p11_session=fixture-session" ? "cookie-ok" : "cookie-missing");
      return;
    }
    if (request.url === "/redirect-off-origin") {
      response.writeHead(302, { location: "https://example.invalid/" });
      response.end();
      return;
    }
    response.writeHead(404);
    response.end("not found");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    origin: `https://127.0.0.1:${address.port}`,
    async stop() { await new Promise((resolve) => server.close(resolve)); },
  };
}

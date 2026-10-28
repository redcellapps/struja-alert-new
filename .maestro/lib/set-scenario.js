// Switches the development mock API's scenario (apps/mobile/mock-server/scenarios.ts).
http.post('http://localhost:3000/__dev/scenario', {
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: SCENARIO }),
});

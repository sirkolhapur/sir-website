// Only shows CRM reminder notifications; it does not intercept any request.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const leadId = event.notification.data && event.notification.data.leadId;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => c.url.includes("/crm.html"));
    if (open) { open.postMessage({ leadId }); return open.focus(); }
    return self.clients.openWindow("crm.html");
  }));
});

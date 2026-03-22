export default function HomePage() {
  return (
    <main>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Face-based Group Photo Sharing</h2>
        <p>
          Upload group photos, detect faces, and auto-share to matched members.
          This starter includes the core pages and API contract stubs.
        </p>
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>MVP flow</h3>
        <ol>
          <li>Enroll face with consent</li>
          <li>Create or join a group</li>
          <li>Upload photos for that group</li>
          <li>Run face processing and auto-share high-confidence matches</li>
        </ol>
      </div>
    </main>
  );
}

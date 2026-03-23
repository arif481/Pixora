export default function HomePage() {
  return (
    <main>
      <div className="card">
        <h2>Face-based Group Photo Sharing</h2>
        <p className="muted">
          Upload group photos, match members with on-device face features, and share results automatically.
          Pixora includes enrollment, groups, uploads, processing, and delivery in one flow.
        </p>
      </div>
      <div className="card">
        <h3>MVP flow</h3>
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

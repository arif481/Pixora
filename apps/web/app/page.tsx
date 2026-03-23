export default function HomePage() {
  return (
    <main>
      <div className="card">
        <h2>Wholesome, Automatic Photo Sharing</h2>
        <p className="muted">
          Create an account, complete face enrollment, and share memories automatically with friends detected in each photo.
          Login uses a live face check, while matching and sharing stay private to authorized users.
        </p>
      </div>
      <div className="card">
        <h3>How it works</h3>
        <ol>
          <li>Sign up and enroll with 5 selfies (upload or camera snapshots)</li>
          <li>Sign in and complete live face verification</li>
          <li>Create/join a group or use your personal memory space</li>
          <li>Upload photos and auto-share detected matches with control over access</li>
        </ol>
      </div>
    </main>
  );
}

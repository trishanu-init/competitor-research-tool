# Competitor Research Tool

Enterprise companies can use this tool to find out which of their competitors have worked with/are working with a given target account.
---
**💡EXAMPLE:**

Your customer wants to sell their services to company ‘A’. 
Before approaching ‘A’, your customer wants to find out which of their competitors have worked with or are working with ‘A’.
This information will help them find what kind of projects ‘A’ has done already with similar solution providers, and they will use this intel to do target them in a personalised way.

---
## How to Run Script using Docker
1.Login to docker
```bash
docker login
```
2.Pull docker file from docker hub
```bash
docker pull trishanu8295/comp-research:0.0.1.RELEASE
```
3. Run docker comtainer in detached mode on port 3000
```bash
docker run -d -p 3000:300 trishanu8295/comp-research:0.0.1.RELEASE
```
4. Navigate ti http://localhost:3000
   
## How to Run Script Locally

1. Fork the repo.

2. After forking, clone the repo to your local machine.
To clone the repo to your local machine, run the following command in your terminal:
    
    ```bash
    git clone https://github.com/<your-github-username>/anapan-ai-assignment
    ```
3. Navigate to the project directory
   ```bash
   cd anapan-ai-assignment
   ```
   ```bash
   npm install
   ```
4. In the project directory, you can run:
   ```bash
    node src/server.js`
   ```
  Runs the app in the development mode.\
  Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

## DEMO
https://github.com/user-attachments/assets/13a5d938-5176-4ead-9886-210ee41bd9c4



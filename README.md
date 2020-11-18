# Rollcall
# Azure AD to Workspace ONE Access SCIM Proxy
 
This is an interface to allow SCIM provisioning for Users and Groups between Azure Active Directory and Workspace ONE Access. Once Users and Groups are created in Access, you can then use the Airwatch Provisioning Application to provision these in Workspace ONE UEM to complete the full synchronisation if needed.

![rollcall flow](https://1.bp.blogspot.com/-QSdleb1BQho/X6zcu6xWHHI/AAAAAAAA99o/O1TWwTNmgd4IbsN_3CRMaRtUnqX0tVnrQCLcBGAsYHQ/s16000/flow.png)

# Project Rollcall consists of two Components:

- **Access Proxy** which is a Node.JS and Express application that listens on your desired port for SCIM API requests/actions from Azure Active Directory and (your)configured Custom Enterprise Application with Provisioning Enabled.
- **Admin UI** which is this configuration and administrative interface. It also is an interface for additional Workspace ONE Access Tools required to complete Provisioning.

Install Instructions here:

[Install Instructions](https://github.com/tbwfdu/rollcall/wiki/Install-Instructions)

--------
#####v1.1.0 - Added Dockerfile to build a fully self sufficient container to run rollcall in. 

Moved files around to make it easier to build automated docker file.
All environment secrets and URLs are now referenced at build from env.template and you need to edit this before builder the Docker container.
After this, this information along with a randomly generated JWT Bearer token are saved into a ./config directory of both accessproxy and admin-ui directories. If you've added all the correct URLs and ClientID/Secrets, it will automatically start and run with no further config needed.
Adding two Docker Volumes for the container to persist /rollcall/accessproxy/config and /rollcall/admin-ui/config will allow you to destroy and recreate the container without any intervention!


*Fixed:*
Removed the requirement to run in development mode as the container has NGINX configured a web server and reverse proxy for both components.



#####v1.0.0 - Initial Release

*Known Issues:*
Admin UI still uses the built-in web server in development mode (ng serve / ng serve --prod) to run. It can be fully compiled in Production Mode but at the moment the API calls use the built-in Angular proxy to communicate with accessproxy to proxy calls to your Workspace ONE Access tenant which isn't easily configurable when compiled. Given that this component should not be externally facing anyway, this should not be a major concern and it is not required for the SCIM Proxy functionality to work if you do not want to run this component. 

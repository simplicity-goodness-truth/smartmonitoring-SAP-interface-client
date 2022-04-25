# smartmonitoring-SAP-interface-client
Machine Learning for SAP Hybrid Operations: Collector Client

Machine Learning Extension  for SAP monitoring is an extra element between SAP Solution Manager 7.2 system and monitoring experts to address key challenges within SAP Solution Manager 7.2:

- Filtering out of redundant alerts, related to recurring metric behavior variations
- Detection of non-threshold violation related deviations

Key architecture aspects of Machine Learning Extension solution:

• Solution is a set of micro services on Python and Node.js running inside Cloud Foundry environment of MLT SAP HANA XSA

• SAP Solution Manager 7.2 Monitoring and Alerting Infrastructure (MAI) is integrated with the solution, deployed to MLT SAP HANA XSA

• Solution anomaly calculation core is based of Machine Learning algorithms and provides API to calculate real-time anomalies ratings for incoming quantifiable metrics of various nature: solution can extend different monitoring scenarios like Technical Monitoring, Interfaces Monitoring, Business KPIs (resources consumption percentages, amount of users, amount of records in specific tables, orders count etc.)

• Machine Learning model doesn’t require labelling, behavior patterns are modeled uniquely for every metric of every monitoring object in scope

• Machine Learning model needs to be trained at least on past two weeks data (human participation is not needed)

• Once Machine Learning model is trained, metrics and alerts data is pulled by solution from SAP Solution Manager 7.2 MAI every 5 minutes

• Incoming metrics values from MAI are compared with predicted metrics values Machine Learning Anomaly Detection service, and anomalies ratings are calculated

• Anomalies measurements are transferred back to SAP Solution Manager MAI for further alerts reliability evaluation and non-threshold violation related anomalies data provision

Collector client mai_interface is a Node.js application, which utilizes standard SAP Application Router package (https://www.npmjs.com/package/@sap/approuter) for access control.

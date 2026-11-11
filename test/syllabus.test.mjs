import { heuristicParse } from '../lib/syllabus.js';
import assert from 'node:assert/strict';

const aktu = `Course Code: KCS-501  Database Management System  L T P 3 1 0
Course Objectives
UNIT – I: Introduction: An overview of database management system, database system vs file system, Database system concept and architecture, data model schema and instances. (8 Hours)
Data Modeling using the Entity Relationship Model: ER model concepts, notation for ER diagram, mapping constraints, keys.
UNIT II Relational data Model and Language
• Relational data model concepts
• Integrity constraints, entity integrity, referential integrity
• Relational algebra; Relational calculus
3. Introduction to SQL: Characteristics of SQL, advantage of SQL
Unit 3: Normalization - Functional dependencies, normal forms, first, second, third normal forms, BCNF
12
Module IV Transaction Processing Concept
a) Transaction system
b) Testing of serializability
Text Books
1. Korth, Silberschatz, Abraham: Database System Concepts, McGraw Hill
2. Elmasri, Navathe: Fundamentals of Database Systems
Course Outcomes
CO1 Apply knowledge of database design methodology`;

const plan = heuristicParse(aktu);
console.log(JSON.stringify(plan, null, 2));
assert.equal(plan.units.length, 4);
assert.equal(plan.units[0].title, 'Unit I: Introduction');
assert.ok(plan.units[1].topics.includes('Relational algebra'));
assert.ok(plan.units[2].topics.includes('BCNF'));
assert.equal(plan.units[2].title, 'Unit 3: Normalization');
assert.ok(!JSON.stringify(plan).includes('Korth'), 'textbooks must be skipped');
assert.ok(!JSON.stringify(plan).includes('CO1'), 'outcomes skipped');

const flat = heuristicParse('Photosynthesis\nRespiration in plants\nCell division: mitosis and meiosis');
assert.equal(flat.units.length, 1);
assert.equal(flat.units[0].title, 'Topics');
assert.equal(flat.units[0].topics.length, 3);
console.log('syllabus parser: all assertions passed');
